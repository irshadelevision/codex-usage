import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import type {
  RangeSummary,
  TokenTotals,
  UsageBreakdownRow,
  UsagePoint,
  UsageRange,
  UsageSnapshot,
} from "../shared/types.ts";
import { USAGE_RANGES } from "../shared/types.ts";
import { loadRates, priceTokens, type RateTable } from "./pricing.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const FORK_COPY_MAX_GAP_MS = 1000;
const CACHE_VERSION = 1;

const EMPTY_TOTALS: TokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export interface UsageRecord {
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
}

interface MutableBreakdown {
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

  const signature = `${state.model}\u0000${state.mode}\u0000${JSON.stringify(lastRecord)}`;
  if (signature === state.lastUsageSignature) return null;
  state.lastUsageSignature = signature;

  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      return null;
    }
    state.suppressingForkCopies = false;
  }

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
  if (totalTokens(totals) === 0) return null;

  return {
    timestampMs,
    model: state.model,
    mode: state.mode,
    sessionId: state.sessionId,
    totals,
  };
}

async function readTranscript(filePath: string): Promise<readonly UsageRecord[] | null> {
  const records: UsageRecord[] = [];
  const state = initialCodexScanState();
  try {
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (
        !line.includes('"token_count"') &&
        !line.includes('"turn_context"') &&
        !line.includes('"session_meta"')
      ) {
        continue;
      }
      const record = parseCodexLine(line, state);
      if (record !== null) records.push(record);
    }
    return records;
  } catch {
    return null;
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

function isUsageRecord(value: unknown): value is UsageRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["timestampMs"] === "number" &&
    typeof record["model"] === "string" &&
    typeof record["mode"] === "string" &&
    typeof record["sessionId"] === "string" &&
    typeof record["totals"] === "object" &&
    record["totals"] !== null
  );
}

async function readScanCache(cachePath: string): Promise<Map<string, ScanCacheEntry>> {
  try {
    const parsed: unknown = JSON.parse(await NodeFSP.readFile(cachePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return new Map();
    const root = parsed as Record<string, unknown>;
    if (root["version"] !== CACHE_VERSION || !Array.isArray(root["entries"])) return new Map();
    const entries = new Map<string, ScanCacheEntry>();
    for (const value of root["entries"]) {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string") continue;
      const raw = value[1];
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (
        typeof entry["size"] !== "number" ||
        typeof entry["mtimeMs"] !== "number" ||
        !Array.isArray(entry["records"]) ||
        !entry["records"].every(isUsageRecord)
      ) {
        continue;
      }
      entries.set(value[0], {
        size: entry["size"],
        mtimeMs: entry["mtimeMs"],
        records: entry["records"],
      });
    }
    return entries;
  } catch {
    return new Map();
  }
}

async function writeScanCache(cachePath: string, cache: ReadonlyMap<string, ScanCacheEntry>) {
  await NodeFSP.writeFile(
    cachePath,
    JSON.stringify({ version: CACHE_VERSION, entries: [...cache.entries()] }),
    "utf8",
  );
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

function rangeDays(range: Exclude<UsageRange, "24h">): number {
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
      costUsd: value.costUsd,
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
  costUsd: number,
  tokens: number,
  sessionId: string,
) {
  const value = target.get(key) ?? { costUsd: 0, totalTokens: 0, sessions: new Set<string>() };
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
): RangeSummary {
  const toDay = makeDayFormatter(timeZone);
  const untilDay = toDay(nowMs);
  const minuteAlignedNow = Math.floor(nowMs / 60_000) * 60_000;
  const sinceTimeMs = minuteAlignedNow - DAY_MS;
  const isHourly = range === "24h";
  const sinceDay = isHourly
    ? toDay(sinceTimeMs)
    : subtractCalendarDays(untilDay, rangeDays(range) - 1);
  const until = isHourly ? new Date(minuteAlignedNow).toISOString() : untilDay;
  const since = isHourly ? new Date(sinceTimeMs).toISOString() : sinceDay;

  const pointKeys = isHourly
    ? Array.from({ length: 24 }, (_, index) =>
        new Date(sinceTimeMs + index * HOUR_MS).toISOString(),
      )
    : enumerateDays(sinceDay, untilDay);
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
    let pointKey: string;
    if (isHourly) {
      if (record.timestampMs < sinceTimeMs || record.timestampMs >= minuteAlignedNow) continue;
      const index = Math.floor((record.timestampMs - sinceTimeMs) / HOUR_MS);
      pointKey = new Date(sinceTimeMs + index * HOUR_MS).toISOString();
    } else {
      pointKey = toDay(record.timestampMs);
      if (pointKey < sinceDay || pointKey > untilDay) continue;
    }

    const tokens = totalTokens(record.totals);
    const priced = priceTokens(rates, record.model, record.totals);
    totals = addTotals(totals, record.totals);
    costUsd += priced.costUsd;
    cacheSavingsUsd += priced.cacheSavingsUsd;
    countedRecords += 1;
    if (!priced.priced) unpricedRecords += 1;
    if (record.sessionId.length > 0) sessions.add(record.sessionId);

    const point = points.get(pointKey);
    if (point !== undefined) {
      point.costUsd += priced.costUsd;
      point.totalTokens += tokens;
    }
    addBreakdown(models, record.model, priced.costUsd, tokens, record.sessionId);
    addBreakdown(modes, record.mode, priced.costUsd, tokens, record.sessionId);
  }

  const allTokens = totalTokens(totals);
  const series: UsagePoint[] = pointKeys.map((key) => ({
    key,
    costUsd: points.get(key)?.costUsd ?? 0,
    totalTokens: points.get(key)?.totalTokens ?? 0,
  }));

  return {
    range,
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
  readonly #scanCachePath: string;
  readonly #ratesCachePath: string;
  #cache: Map<string, ScanCacheEntry> | null = null;

  constructor(input: {
    readonly sessionsPath: string;
    readonly scanCachePath: string;
    readonly ratesCachePath: string;
  }) {
    this.#sessionsPath = input.sessionsPath;
    this.#scanCachePath = input.scanCachePath;
    this.#ratesCachePath = input.ratesCachePath;
  }

  async scan(nowMs = Date.now()): Promise<Omit<UsageSnapshot, "rateLimits">> {
    const startedAt = Date.now();
    if (this.#cache === null) this.#cache = await readScanCache(this.#scanCachePath);

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const untilDay = makeDayFormatter(timeZone)(nowMs);
    const sinceDay = subtractCalendarDays(untilDay, 89);
    const earliestMs = Date.parse(`${sinceDay}T00:00:00Z`) - MTIME_SLACK_MS;
    const [pricing, files] = await Promise.all([
      loadRates(this.#ratesCachePath, nowMs),
      listTranscriptFiles(this.#sessionsPath, earliestMs),
    ]);

    const records: UsageRecord[] = [];
    const livePaths = new Set<string>();
    let scannedFiles = 0;
    let skippedFiles = 0;
    let cacheChanged = false;

    for (const file of files) {
      livePaths.add(file.path);
      const cached = this.#cache.get(file.path);
      if (cached?.size === file.size && cached.mtimeMs === file.mtimeMs) {
        records.push(...cached.records);
        if (cached.records.length === 0) skippedFiles += 1;
        else scannedFiles += 1;
        continue;
      }

      const parsed = await readTranscript(file.path);
      if (parsed === null) {
        skippedFiles += 1;
        continue;
      }
      this.#cache.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, records: parsed });
      cacheChanged = true;
      records.push(...parsed);
      if (parsed.length === 0) skippedFiles += 1;
      else scannedFiles += 1;
    }

    for (const path of this.#cache.keys()) {
      if (!livePaths.has(path)) {
        this.#cache.delete(path);
        cacheChanged = true;
      }
    }
    if (cacheChanged) {
      await writeScanCache(this.#scanCachePath, this.#cache).catch(() => undefined);
    }

    const summaries = Object.fromEntries(
      USAGE_RANGES.map((range) => [
        range,
        aggregateRange(records, range, nowMs, timeZone, pricing.rates),
      ]),
    ) as Record<UsageRange, RangeSummary>;

    return {
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
      ranges: summaries,
    };
  }
}
