import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type {
  RangeSummary,
  TokenTotals,
  UsageBreakdownRow,
  UsagePoint,
  UsageRange,
  UsageSnapshot,
  UsageProvider,
} from "../shared/types.ts";
import { USAGE_RANGES } from "../shared/types.ts";
import {
  earliestCustomDate,
  validateCustomRange,
  type CustomRange,
} from "../shared/customRange.ts";
import { loadRates, priceTokens, type RateTable } from "./pricing.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const FORK_COPY_MAX_GAP_MS = 1000;
const CACHE_VERSION = 4;
const TRANSCRIPT_GUARD_BYTES = 64;

const EMPTY_TOTALS: TokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export interface UsageRecord {
  readonly provider?: "codex" | "claude";
  readonly dedupeKey?: string | null;
  readonly fast?: boolean;
  readonly reportedCostUsd?: number | null;
  readonly timestampMs: number;
  readonly model: string;
  readonly mode: string;
  readonly sessionId: string;
  readonly totals: TokenTotals;
}

export interface CodexScanState {
  model: string;
  mode: string;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

interface TranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

interface ScanCacheEntry {
  readonly size: number;
  readonly mtimeMs: number;
  readonly records: readonly UsageRecord[];
  readonly provider?: "codex" | "claude";
  readonly tailRecords?: readonly UsageRecord[];
  readonly position?: TranscriptPosition;
}

export interface TranscriptPosition {
  readonly offset: number;
  readonly guardHash: string;
  readonly codexState: CodexScanState | null;
}

export interface TranscriptReadResult {
  readonly records: readonly UsageRecord[];
  readonly tailRecords: readonly UsageRecord[];
  readonly position: TranscriptPosition;
  readonly resumed: boolean;
  readonly size: number;
  readonly mtimeMs: number;
}

interface MutableBreakdown {
  unpricedRecords: number;
  pricedRecords: number;
  readonly model: string;
  readonly mode: string | null;
  costUsd: number;
  totalTokens: number;
  sessions: Set<string>;
}

interface MutablePoint {
  costUsd: number;
  totalTokens: number;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeMode(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? "unknown" : normalized;
}

function totalTokens(totals: TokenTotals): number {
  return (
    totals.uncachedInputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationTokens +
    totals.outputTokens
  );
}

function addTotals(left: TokenTotals, right: TokenTotals): TokenTotals {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheCreationOneHourTokens:
      (left.cacheCreationOneHourTokens ?? 0) + (right.cacheCreationOneHourTokens ?? 0),
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  };
}

function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload["forked_from_id"] === "string") return true;
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  if (typeof subagent !== "object" || subagent === null) return false;
  const spawn = (subagent as Record<string, unknown>)["thread_spawn"];
  if (typeof spawn !== "object" || spawn === null) return false;
  return typeof (spawn as Record<string, unknown>)["parent_thread_id"] === "string";
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    mode: "unknown",
    sessionId: "",
    lastUsageSignature: null,
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
  };
}

/**
 * Reduces one Codex rollout line to a token delta. This follows T3 Code's
 * production parser, with reasoning mode carried forward from turn_context.
 */
export function parseCodexLine(line: string, state: CodexScanState): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const payload = record["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const payloadRecord = payload as Record<string, unknown>;

  if (record["type"] === "session_meta") {
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payloadRecord["id"] ?? payloadRecord["session_id"];
    if (typeof id === "string") state.sessionId = id;
    const timestampMs = parseTimestampMs(record["timestamp"]);
    if (timestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = timestampMs;
    }
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string") state.model = payloadRecord["model"];
    state.mode = normalizeMode(payloadRecord["effort"] ?? payloadRecord["reasoning_effort"]);
    // The CLI can emit the same token totals for two different turns. Only
    // de-duplicate repeated events within the current turn.
    state.lastUsageSignature = null;
    return null;
  }

  if (payloadRecord["type"] !== "token_count") return null;
  const info = payloadRecord["info"];
  if (typeof info !== "object" || info === null) return null;
  const last = (info as Record<string, unknown>)["last_token_usage"];
  if (typeof last !== "object" || last === null) return null;
  const lastRecord = last as Record<string, unknown>;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null || state.model.length === 0) return null;

  const inputTokens = int(lastRecord["input_tokens"]);
  const cachedInputTokens = int(lastRecord["cached_input_tokens"]);
  const cacheCreationTokens = int(lastRecord["cache_write_input_tokens"]);
  const outputTokens = int(lastRecord["output_tokens"]);
  const totals: TokenTotals = {
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, int(lastRecord["reasoning_output_tokens"])),
  };
  // Persist only normalized usage metadata, never arbitrary transcript properties.
  const signature = `${state.model}\u0000${state.mode}\u0000${JSON.stringify(totals)}`;
  if (signature === state.lastUsageSignature) return null;
  state.lastUsageSignature = signature;

  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      return null;
    }
    state.suppressingForkCopies = false;
  }
  if (totalTokens(totals) === 0) return null;

  return {
    timestampMs,
    provider: "codex",
    model: state.model,
    mode: state.mode,
    sessionId: state.sessionId,
    totals,
  };
}

/** Claude emits repeated assistant content blocks with the same message/request usage. */
export function parseClaudeLine(line: string): UsageRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw["type"] !== "assistant") return null;
  const message = raw["message"];
  if (typeof message !== "object" || message === null) return null;
  const msg = message as Record<string, unknown>;
  const usage = msg["usage"];
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const model = typeof msg["model"] === "string" ? msg["model"] : "";
  const timestampMs = parseTimestampMs(raw["timestamp"]);
  if (timestampMs === null || !model || model === "<synthetic>" || model === "synthetic")
    return null;
  const creation = u["cache_creation"];
  const oneHour =
    typeof creation === "object" && creation !== null
      ? int((creation as Record<string, unknown>)["ephemeral_1h_input_tokens"])
      : 0;
  const totals: TokenTotals = {
    uncachedInputTokens: int(u["input_tokens"]),
    cachedInputTokens: int(u["cache_read_input_tokens"]),
    cacheCreationTokens: int(u["cache_creation_input_tokens"]),
    cacheCreationOneHourTokens: Math.min(oneHour, int(u["cache_creation_input_tokens"])),
    outputTokens: int(u["output_tokens"]),
    reasoningTokens: 0,
  };
  if (totalTokens(totals) === 0) return null;
  const id = typeof msg["id"] === "string" ? msg["id"] : "";
  const request = typeof raw["requestId"] === "string" ? raw["requestId"] : "";
  const cost = raw["costUSD"];
  return {
    provider: "claude",
    timestampMs,
    model,
    mode: "unknown",
    sessionId: typeof raw["sessionId"] === "string" ? raw["sessionId"] : "",
    totals,
    fast: u["speed"] === "fast",
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
    dedupeKey: id || request ? JSON.stringify([id, request]) : null,
  };
}

export function deduplicateUsage(records: readonly UsageRecord[]): UsageRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (!record.dedupeKey) return true;
    const key = `${record.provider}:${record.dedupeKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function transcriptGuard(handle: NodeFSP.FileHandle, offset: number): Promise<string> {
  const length = Math.min(offset, TRANSCRIPT_GUARD_BYTES);
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset - length);
  if (bytesRead !== length) throw new Error("Transcript changed while scanning");
  return NodeCrypto.createHash("sha256").update(buffer).digest("hex");
}

/** Resume only newline-terminated records; an unfinished last line is replayed next time. */
export async function readTranscript(
  filePath: string,
  provider: "codex" | "claude",
  previous?: TranscriptPosition,
): Promise<TranscriptReadResult | null> {
  const records: UsageRecord[] = [];
  let handle: NodeFSP.FileHandle | undefined;
  try {
    handle = await NodeFSP.open(filePath, "r");
    const stats = await handle.stat();
    const resumed =
      previous !== undefined &&
      previous.offset <= stats.size &&
      (provider === "codex" ? previous.codexState !== null : previous.codexState === null) &&
      (await transcriptGuard(handle, previous.offset)) === previous.guardHash;
    const state =
      resumed && previous?.codexState ? { ...previous.codexState } : initialCodexScanState();
    const parseLine = (line: string, scanState: CodexScanState): UsageRecord | null => {
      if (provider === "claude") {
        if (!line.includes('"usage"')) return null;
        const record = parseClaudeLine(line);
        return record === null ? null : { ...record, sessionId: record.sessionId || filePath };
      }
      if (
        !line.includes('"token_count"') &&
        !line.includes('"turn_context"') &&
        !line.includes('"session_meta"')
      ) {
        return null;
      }
      const record = parseCodexLine(line, scanState);
      return record === null ? null : { ...record, sessionId: record.sessionId || filePath };
    };

    let offset = resumed ? previous!.offset : 0;
    let pending: Buffer[] = [];
    let pendingLength = 0;
    if (offset < stats.size) {
      // Bound the stream to this snapshot so bytes appended during the read are scanned later.
      const stream = handle.createReadStream({
        start: offset,
        end: stats.size - 1,
        autoClose: false,
        highWaterMark: 256 * 1024,
      });
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        let start = 0;
        for (let end = chunk.indexOf(10, start); end !== -1; end = chunk.indexOf(10, start)) {
          const part = chunk.subarray(start, end);
          const line =
            pendingLength === 0
              ? part.toString("utf8")
              : Buffer.concat([...pending, part], pendingLength + part.length).toString("utf8");
          const record = parseLine(line, state);
          if (record !== null) records.push(record);
          offset += pendingLength + part.length + 1;
          pending = [];
          pendingLength = 0;
          start = end + 1;
        }
        if (start < chunk.length) {
          const part = chunk.subarray(start);
          pending.push(part);
          pendingLength += part.length;
        }
      }
    }
    const tail =
      pendingLength > 0
        ? parseLine(Buffer.concat(pending, pendingLength).toString("utf8"), { ...state })
        : null;
    return {
      records,
      tailRecords: tail === null ? [] : [tail],
      resumed,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      position: {
        offset,
        guardHash: await transcriptGuard(handle, offset),
        codexState: provider === "codex" ? state : null,
      },
    };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function listTranscriptFiles(root: string, sinceMtimeMs: number): Promise<TranscriptFile[]> {
  const found: TranscriptFile[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const child = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      try {
        const stats = await NodeFSP.stat(child);
        if (stats.mtimeMs >= sinceMtimeMs) {
          found.push({ path: child, size: stats.size, mtimeMs: stats.mtimeMs });
        }
      } catch {
        // Rollout files can rotate while the directory is being walked.
      }
    }
  };
  await walk(root);
  return found;
}

function isTokenTotals(value: unknown): value is TokenTotals {
  if (typeof value !== "object" || value === null) return false;
  const totals = value as Record<string, unknown>;
  return [
    totals["uncachedInputTokens"],
    totals["cachedInputTokens"],
    totals["cacheCreationTokens"],
    totals["outputTokens"],
    totals["reasoningTokens"],
    totals["cacheCreationOneHourTokens"] ?? 0,
  ].every((total) => typeof total === "number" && Number.isFinite(total) && total >= 0);
}

function isUsageRecord(value: unknown): value is UsageRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["timestampMs"] === "number" &&
    Number.isFinite(record["timestampMs"]) &&
    record["timestampMs"] >= 0 &&
    typeof record["model"] === "string" &&
    typeof record["mode"] === "string" &&
    typeof record["sessionId"] === "string" &&
    (record["provider"] === "codex" || record["provider"] === "claude") &&
    (record["dedupeKey"] === undefined ||
      record["dedupeKey"] === null ||
      typeof record["dedupeKey"] === "string") &&
    (record["fast"] === undefined || typeof record["fast"] === "boolean") &&
    (record["reportedCostUsd"] === undefined ||
      record["reportedCostUsd"] === null ||
      (typeof record["reportedCostUsd"] === "number" &&
        Number.isFinite(record["reportedCostUsd"]) &&
        record["reportedCostUsd"] >= 0)) &&
    isTokenTotals(record["totals"])
  );
}

function isTranscriptPosition(value: unknown, size: number): value is TranscriptPosition {
  if (typeof value !== "object" || value === null) return false;
  const position = value as Record<string, unknown>;
  if (
    typeof position["offset"] !== "number" ||
    !Number.isSafeInteger(position["offset"]) ||
    position["offset"] < 0 ||
    position["offset"] > size ||
    typeof position["guardHash"] !== "string" ||
    !/^[a-f0-9]{64}$/.test(position["guardHash"])
  )
    return false;
  if (position["codexState"] === null) return true;
  if (typeof position["codexState"] !== "object" || position["codexState"] === null) return false;
  const state = position["codexState"] as Record<string, unknown>;
  return (
    typeof state["model"] === "string" &&
    typeof state["mode"] === "string" &&
    typeof state["sessionId"] === "string" &&
    (state["lastUsageSignature"] === null || typeof state["lastUsageSignature"] === "string") &&
    typeof state["sawSessionMeta"] === "boolean" &&
    typeof state["suppressingForkCopies"] === "boolean" &&
    typeof state["forkCopyAnchorMs"] === "number" &&
    Number.isFinite(state["forkCopyAnchorMs"])
  );
}

async function readScanCache(cachePath: string): Promise<Map<string, ScanCacheEntry>> {
  try {
    const parsed: unknown = JSON.parse(await NodeFSP.readFile(cachePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return new Map();
    const root = parsed as Record<string, unknown>;
    // Version 3 still contains useful history, but must be fully read before resuming.
    if (
      (root["version"] !== 3 && root["version"] !== CACHE_VERSION) ||
      !Array.isArray(root["entries"])
    )
      return new Map();
    const entries = new Map<string, ScanCacheEntry>();
    for (const value of root["entries"]) {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string") continue;
      const raw = value[1];
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (
        typeof entry["size"] !== "number" ||
        !Number.isSafeInteger(entry["size"]) ||
        entry["size"] < 0 ||
        typeof entry["mtimeMs"] !== "number" ||
        !Number.isFinite(entry["mtimeMs"]) ||
        entry["mtimeMs"] < 0 ||
        !Array.isArray(entry["records"]) ||
        !entry["records"].every(isUsageRecord)
      ) {
        continue;
      }
      entries.set(value[0], {
        size: entry["size"],
        mtimeMs: entry["mtimeMs"],
        records: entry["records"],
        ...(entry["provider"] === "codex" || entry["provider"] === "claude"
          ? { provider: entry["provider"] }
          : {}),
        ...(Array.isArray(entry["tailRecords"]) && entry["tailRecords"].every(isUsageRecord)
          ? { tailRecords: entry["tailRecords"] }
          : {}),
        ...(root["version"] === CACHE_VERSION &&
        isTranscriptPosition(entry["position"], entry["size"])
          ? { position: entry["position"] }
          : {}),
      });
    }
    return entries;
  } catch {
    return new Map();
  }
}

async function writeScanCache(cachePath: string, cache: ReadonlyMap<string, ScanCacheEntry>) {
  const temporaryPath = `${cachePath}.tmp`;
  await NodeFSP.writeFile(
    temporaryPath,
    JSON.stringify({ version: CACHE_VERSION, entries: [...cache.entries()] }),
    "utf8",
  );
  await NodeFSP.rename(temporaryPath, cachePath);
}

function withinSource(filePath: string, root: string): boolean {
  const relative = NodePath.relative(NodePath.resolve(root), NodePath.resolve(filePath));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${NodePath.sep}`) &&
    !NodePath.isAbsolute(relative)
  );
}

/** Stable session events survive file moves, while equal deltas in distinct turns remain distinct. */
function appendTranscriptRecords(destination: UsageRecord[], entry: ScanCacheEntry): void {
  const occurrences = new Map<string, number>();
  for (const record of [...entry.records, ...(entry.tailRecords ?? [])]) {
    if (record.provider !== "codex") {
      destination.push(record);
      continue;
    }
    const key = JSON.stringify([
      record.sessionId,
      record.timestampMs,
      record.model,
      record.mode,
      record.totals.uncachedInputTokens,
      record.totals.cachedInputTokens,
      record.totals.cacheCreationTokens,
      record.totals.outputTokens,
      record.totals.reasoningTokens,
    ]);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    destination.push({ ...record, dedupeKey: `${key}:${occurrence}` });
  }
}

function makeDayFormatter(timeZone: string): (timestampMs: number) => string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return (timestampMs) => format.format(new Date(timestampMs));
}

function subtractCalendarDays(day: string, count: number): string {
  const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth - count)).toISOString().slice(0, 10);
}

function enumerateDays(since: string, until: string): string[] {
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

function rangeDays(range: UsageRange): number {
  if (range === "24h") return 1;
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  return 90;
}

function buildBreakdownRows(
  source: ReadonlyMap<string, MutableBreakdown>,
  costUsd: number,
  allTokens: number,
): UsageBreakdownRow[] {
  return [...source.entries()]
    .map(([key, value]) => ({
      key,
      model: value.model,
      mode: value.mode,
      costUsd: value.costUsd,
      unpricedRecords: value.unpricedRecords,
      pricedRecords: value.pricedRecords,
      costShare: costUsd === 0 ? 0 : value.costUsd / costUsd,
      totalTokens: value.totalTokens,
      tokenShare: allTokens === 0 ? 0 : value.totalTokens / allTokens,
      sessions: value.sessions.size,
    }))
    .sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens);
}

function addBreakdown(
  target: Map<string, MutableBreakdown>,
  key: string,
  model: string,
  mode: string | null,
  costUsd: number,
  tokens: number,
  sessionId: string,
  priced: boolean,
) {
  const value = target.get(key) ?? {
    model,
    mode,
    costUsd: 0,
    totalTokens: 0,
    sessions: new Set<string>(),
    unpricedRecords: 0,
    pricedRecords: 0,
  };
  if (priced) value.pricedRecords += 1;
  else value.unpricedRecords += 1;
  value.costUsd += costUsd;
  value.totalTokens += tokens;
  if (sessionId.length > 0) value.sessions.add(sessionId);
  target.set(key, value);
}

export function aggregateRange(
  records: readonly UsageRecord[],
  range: UsageRange,
  nowMs: number,
  timeZone: string,
  rates: RateTable,
  custom?: CustomRange,
): RangeSummary {
  const toDay = makeDayFormatter(timeZone);
  const untilDay = toDay(nowMs);
  const minuteAlignedNow = Math.floor(nowMs / 60_000) * 60_000;
  const sinceTimeMs = custom ? Date.parse(custom.start) : minuteAlignedNow - DAY_MS;
  const endTimeMs = custom ? Date.parse(custom.end) : minuteAlignedNow;
  const isHourly = custom ? endTimeMs - sinceTimeMs <= 2 * DAY_MS : range === "24h";
  const sinceDay = isHourly
    ? toDay(sinceTimeMs)
    : custom
      ? toDay(sinceTimeMs)
      : subtractCalendarDays(untilDay, rangeDays(range) - 1);
  const until = custom?.end ?? (isHourly ? new Date(minuteAlignedNow).toISOString() : untilDay);
  const since = custom?.start ?? (isHourly ? new Date(sinceTimeMs).toISOString() : sinceDay);

  const pointKeys = isHourly
    ? Array.from({ length: Math.ceil((endTimeMs - sinceTimeMs) / HOUR_MS) }, (_, index) =>
        new Date(sinceTimeMs + index * HOUR_MS).toISOString(),
      )
    : enumerateDays(sinceDay, custom ? toDay(endTimeMs - 1) : untilDay);
  const points = new Map<string, MutablePoint>(
    pointKeys.map((key) => [key, { costUsd: 0, totalTokens: 0 }]),
  );
  const models = new Map<string, MutableBreakdown>();
  const modes = new Map<string, MutableBreakdown>();
  const sessions = new Set<string>();
  let totals = EMPTY_TOTALS;
  let costUsd = 0;
  let cacheSavingsUsd = 0;
  let countedRecords = 0;
  let unpricedRecords = 0;

  for (const record of records) {
    if (record.timestampMs > nowMs) continue;
    if (custom && (record.timestampMs < sinceTimeMs || record.timestampMs >= endTimeMs)) continue;
    let pointKey: string;
    if (isHourly) {
      if (record.timestampMs < sinceTimeMs || record.timestampMs >= endTimeMs) continue;
      const index = Math.floor((record.timestampMs - sinceTimeMs) / HOUR_MS);
      pointKey = new Date(sinceTimeMs + index * HOUR_MS).toISOString();
    } else {
      pointKey = toDay(record.timestampMs);
      if (pointKey < sinceDay || pointKey > untilDay) continue;
    }

    const tokens = totalTokens(record.totals);
    const priced = priceTokens(rates, record.model, record.totals, record);
    totals = addTotals(totals, record.totals);
    costUsd += priced.costUsd;
    cacheSavingsUsd += priced.cacheSavingsUsd;
    countedRecords += 1;
    if (!priced.priced) unpricedRecords += 1;
    const sessionKey = record.sessionId ? `${record.provider ?? "codex"}:${record.sessionId}` : "";
    if (sessionKey) sessions.add(sessionKey);

    const point = points.get(pointKey);
    if (point !== undefined) {
      point.costUsd += priced.costUsd;
      point.totalTokens += tokens;
    }
    addBreakdown(
      models,
      record.model,
      record.model,
      null,
      priced.costUsd,
      tokens,
      sessionKey,
      priced.priced,
    );
    addBreakdown(
      modes,
      JSON.stringify([record.model, record.mode]),
      record.model,
      record.mode,
      priced.costUsd,
      tokens,
      sessionKey,
      priced.priced,
    );
  }

  const allTokens = totalTokens(totals);
  const series: UsagePoint[] = pointKeys.map((key) => ({
    key,
    costUsd: points.get(key)?.costUsd ?? 0,
    totalTokens: points.get(key)?.totalTokens ?? 0,
  }));

  return {
    range: custom ? "custom" : range,
    since,
    until,
    costUsd,
    totals,
    totalTokens: allTokens,
    cacheSavingsUsd,
    records: countedRecords,
    sessions: sessions.size,
    unpricedRecords,
    series,
    models: buildBreakdownRows(models, costUsd, allTokens),
    modes: buildBreakdownRows(modes, costUsd, allTokens),
  };
}

export class CodexUsageScanner {
  readonly #sessionsPath: string;
  readonly #claudeProjectsPath: string | undefined;
  readonly #scanCachePath: string;
  readonly #ratesCachePath: string;
  #cache: Map<string, ScanCacheEntry> | null = null;
  #cacheDirty = false;

  constructor(input: {
    readonly sessionsPath: string;
    readonly claudeProjectsPath?: string;
    readonly scanCachePath: string;
    readonly ratesCachePath: string;
  }) {
    this.#sessionsPath = input.sessionsPath;
    this.#claudeProjectsPath = input.claudeProjectsPath;
    this.#scanCachePath = input.scanCachePath;
    this.#ratesCachePath = input.ratesCachePath;
  }

  #queue: Promise<unknown> = Promise.resolve();

  scan(
    nowMs = Date.now(),
    custom?: CustomRange,
    provider: UsageProvider = "all",
    forceRates = false,
  ): Promise<Omit<UsageSnapshot, "exchangeRates" | "rateLimits" | "claudeRateLimits">> {
    const checked = custom ? validateCustomRange(custom, nowMs) : undefined;
    const result = this.#queue.then(() => this.#scan(nowMs, checked, provider, forceRates));
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #scan(
    nowMs: number,
    custom?: CustomRange,
    provider: UsageProvider = "all",
    forceRates = false,
  ): Promise<Omit<UsageSnapshot, "exchangeRates" | "rateLimits" | "claudeRateLimits">> {
    const startedAt = Date.now();
    if (this.#cache === null) {
      this.#cache = await readScanCache(this.#scanCachePath);
      this.#cacheDirty = this.#cache.size > 0;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const untilDay = makeDayFormatter(timeZone)(nowMs);
    const sinceDay = subtractCalendarDays(untilDay, 89);
    const earliestMs =
      Math.min(Date.parse(`${sinceDay}T00:00:00Z`), custom ? Date.parse(custom.start) : Infinity) -
      MTIME_SLACK_MS;
    const retentionMs = earliestCustomDate(nowMs).getTime() - MTIME_SLACK_MS;
    const [pricing, codexFiles, claudeFiles] = await Promise.all([
      loadRates(this.#ratesCachePath, nowMs, { force: forceRates }),
      listTranscriptFiles(this.#sessionsPath, earliestMs),
      this.#claudeProjectsPath ? listTranscriptFiles(this.#claudeProjectsPath, earliestMs) : [],
    ]);
    const files = [
      ...codexFiles.map((file) => ({ ...file, provider: "codex" as const })),
      ...claudeFiles.map((file) => ({ ...file, provider: "claude" as const })),
    ].sort((a, b) => a.path.localeCompare(b.path));

    const records: UsageRecord[] = [];
    const livePaths = new Set<string>();
    let scannedFiles = 0;
    let skippedFiles = 0;

    for (const file of files) {
      livePaths.add(file.path);
      const held = this.#cache.get(file.path);
      const cached =
        held &&
        (held.provider === undefined || held.provider === file.provider) &&
        [...held.records, ...(held.tailRecords ?? [])].every(
          (record) => record.provider === file.provider,
        )
          ? held
          : undefined;
      if (cached?.size === file.size && cached.mtimeMs === file.mtimeMs) {
        appendTranscriptRecords(records, cached);
        if (cached.records.length + (cached.tailRecords?.length ?? 0) === 0) skippedFiles += 1;
        else scannedFiles += 1;
        continue;
      }

      const parsed = await readTranscript(
        file.path,
        file.provider,
        cached && file.size > cached.size ? cached.position : undefined,
      );
      if (parsed === null) {
        // A temporary read failure must not erase the last successful result.
        if (cached) appendTranscriptRecords(records, cached);
        skippedFiles += 1;
        continue;
      }
      const entry: ScanCacheEntry = {
        provider: file.provider,
        size: parsed.size,
        mtimeMs: parsed.mtimeMs,
        records: deduplicateUsage(
          parsed.resumed && cached ? [...cached.records, ...parsed.records] : parsed.records,
        ),
        tailRecords: parsed.tailRecords,
        position: parsed.position,
      };
      this.#cache.set(file.path, entry);
      this.#cacheDirty = true;
      appendTranscriptRecords(records, entry);
      if (entry.records.length + (entry.tailRecords?.length ?? 0) === 0) skippedFiles += 1;
      else scannedFiles += 1;
    }

    for (const [path, cached] of this.#cache) {
      if (cached.mtimeMs < retentionMs) {
        this.#cache.delete(path);
        this.#cacheDirty = true;
        continue;
      }
      if (!livePaths.has(path)) {
        // Keep history after transcript cleanup, but never import another account's source cache.
        const provider = withinSource(path, this.#sessionsPath)
          ? "codex"
          : this.#claudeProjectsPath && withinSource(path, this.#claudeProjectsPath)
            ? "claude"
            : null;
        if (provider === null || (cached.provider !== undefined && cached.provider !== provider))
          continue;
        const selected = {
          ...cached,
          records: cached.records.filter((record) => record.provider === provider),
          tailRecords: (cached.tailRecords ?? []).filter((record) => record.provider === provider),
        };
        appendTranscriptRecords(records, selected);
        if (selected.records.length + (selected.tailRecords?.length ?? 0) > 0) scannedFiles += 1;
      }
    }
    if (this.#cacheDirty) {
      try {
        await writeScanCache(this.#scanCachePath, this.#cache);
        this.#cacheDirty = false;
      } catch {
        // Retry on the next scan even if no transcript has changed.
      }
    }

    const uniqueRecords = deduplicateUsage(records);
    const byProvider = {
      codex: uniqueRecords.filter((record) => record.provider !== "claude"),
      claude: uniqueRecords.filter((record) => record.provider === "claude"),
    };
    const summarize = (selected: readonly UsageRecord[]) =>
      Object.fromEntries(
        USAGE_RANGES.map((range) => [
          range,
          aggregateRange(selected, range, nowMs, timeZone, pricing.rates),
        ]),
      ) as Record<UsageRange, RangeSummary>;

    return {
      ...(custom
        ? {
            customSummary: aggregateRange(
              provider === "all" ? uniqueRecords : byProvider[provider],
              "90d",
              nowMs,
              timeZone,
              pricing.rates,
              custom,
            ),
          }
        : {}),
      readAt: new Date(nowMs).toISOString(),
      sourcePath: this.#sessionsPath,
      scannedFiles,
      skippedFiles,
      scanDurationMs: Math.max(0, Date.now() - startedAt),
      pricing: {
        status: pricing.status,
        knownModels: pricing.rates.size,
        fetchedAt:
          pricing.fetchedAtMs === null ? null : new Date(pricing.fetchedAtMs).toISOString(),
      },
      ranges: summarize(uniqueRecords),
      providerRanges: { codex: summarize(byProvider.codex), claude: summarize(byProvider.claude) },
      ...(this.#claudeProjectsPath ? { claudeSourcePath: this.#claudeProjectsPath } : {}),
    };
  }
}
