import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import type {
  CodexRateLimitResetCredits,
  CodexRateLimitWindow,
  CodexRateLimits,
} from "../shared/types.ts";

const FIVE_HOUR_MINUTES = 5 * 60;
const WEEK_MINUTES = 7 * 24 * 60;
const APP_SERVER_TIMEOUT_MS = 15_000;

interface RateLimitWindow {
  readonly usedPercent: number;
  readonly windowDurationMins: number | null;
  readonly resetsAt: number | null;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampToIso(value: number | null): string | null {
  if (value === null || value < 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseResetCredits(value: unknown): CodexRateLimitResetCredits | null {
  const input = object(value);
  const rawCount = finiteNumber(input?.["availableCount"]);
  const availableCount = rawCount === null ? 0 : Math.max(0, Math.trunc(rawCount));
  if (availableCount === 0) return null;

  const details = Array.isArray(input?.["credits"])
    ? input.credits
        .flatMap((value) => {
          const credit = object(value);
          return credit?.["status"] === "available" ? [credit] : [];
        })
        .toSorted(
          (left, right) =>
            (finiteNumber(left["expiresAt"]) ?? Number.POSITIVE_INFINITY) -
            (finiteNumber(right["expiresAt"]) ?? Number.POSITIVE_INFINITY),
        )
    : [];
  const nextCredit = details[0];

  return {
    availableCount,
    title: nonEmptyString(nextCredit?.["title"]),
    expiresAt: timestampToIso(finiteNumber(nextCredit?.["expiresAt"])),
  };
}

function parseWindow(value: unknown): RateLimitWindow | null {
  const input = object(value);
  if (input === null) return null;
  const usedPercent = finiteNumber(input["usedPercent"]);
  if (usedPercent === null) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, Math.round(usedPercent))),
    windowDurationMins: Math.max(0, finiteNumber(input["windowDurationMins"]) ?? 0) || null,
    resetsAt: finiteNumber(input["resetsAt"]),
  };
}

function bucketWindows(bucket: Record<string, unknown>): readonly RateLimitWindow[] {
  return [parseWindow(bucket["primary"]), parseWindow(bucket["secondary"])].filter(
    (window): window is RateLimitWindow => window !== null,
  );
}

function fiveHourWindow(bucket: Record<string, unknown>): RateLimitWindow | null {
  return (
    bucketWindows(bucket).find(
      ({ windowDurationMins }) => windowDurationMins === FIVE_HOUR_MINUTES,
    ) ?? null
  );
}

function weeklyWindow(bucket: Record<string, unknown>): RateLimitWindow | null {
  const windows = bucketWindows(bucket).toSorted(
    (left, right) => (right.windowDurationMins ?? 0) - (left.windowDurationMins ?? 0),
  );
  const longest = windows[0];
  if (longest === undefined || (longest.windowDurationMins ?? 0) < WEEK_MINUTES) return null;
  return longest;
}

function toRateLimit(
  fallbackId: string,
  fallbackName: string,
  bucket: Record<string, unknown>,
  window: RateLimitWindow | null,
): CodexRateLimitWindow | null {
  if (window === null) return null;
  const limitId =
    typeof bucket["limitId"] === "string" && bucket["limitId"].length > 0
      ? bucket["limitId"]
      : fallbackId;
  const name =
    typeof bucket["limitName"] === "string" && bucket["limitName"].length > 0
      ? bucket["limitName"]
      : fallbackName;
  return {
    limitId,
    name,
    usedPercent: window.usedPercent,
    remainingPercent: 100 - window.usedPercent,
    resetsAt: timestampToIso(window.resetsAt),
    windowDurationMins: window.windowDurationMins,
  };
}

export function parseRateLimitResponse(value: unknown, readAt: string): CodexRateLimits {
  const envelope = object(value);
  const response = object(envelope?.["limits"]) ?? envelope;
  const accountResult = object(envelope?.["account"]);
  const account = object(accountResult?.["account"]);
  const fallback = object(response?.["rateLimits"]);
  const keyed = object(response?.["rateLimitsByLimitId"]);
  const buckets =
    keyed === null
      ? []
      : Object.entries(keyed).flatMap(([key, raw]) => {
          const bucket = object(raw);
          return bucket === null ? [] : [{ key, bucket }];
        });

  const codexBucket =
    buckets.find(({ key, bucket }) => key === "codex" || bucket["limitId"] === "codex")?.bucket ??
    fallback;
  const sparkBucket = buckets.find(({ key, bucket }) => {
    const id = typeof bucket["limitId"] === "string" ? bucket["limitId"] : key;
    const name = typeof bucket["limitName"] === "string" ? bucket["limitName"] : "";
    return id.toLowerCase().includes("spark") || name.toLowerCase().includes("spark");
  })?.bucket;
  const codex =
    codexBucket === null
      ? null
      : toRateLimit("codex", "Codex plan", codexBucket, weeklyWindow(codexBucket));
  const spark =
    sparkBucket === undefined
      ? null
      : toRateLimit("codex-spark", "Codex Spark", sparkBucket, weeklyWindow(sparkBucket));
  const codexFiveHour =
    codexBucket === null
      ? null
      : toRateLimit("codex", "Codex plan", codexBucket, fiveHourWindow(codexBucket));
  const sparkFiveHour =
    sparkBucket === undefined
      ? null
      : toRateLimit("codex-spark", "Codex Spark", sparkBucket, fiveHourWindow(sparkBucket));
  const resetCredits = parseResetCredits(response?.["rateLimitResetCredits"]);
  const planType =
    typeof account?.["planType"] === "string"
      ? account["planType"]
      : typeof codexBucket?.["planType"] === "string"
        ? codexBucket["planType"]
        : typeof fallback?.["planType"] === "string"
          ? fallback["planType"]
          : typeof response?.["planType"] === "string"
            ? response["planType"]
            : null;

  return {
    status:
      codex === null &&
      spark === null &&
      codexFiveHour === null &&
      sparkFiveHour === null &&
      resetCredits === null
        ? "unavailable"
        : "available",
    readAt,
    planType,
    codex,
    spark,
    codexFiveHour,
    sparkFiveHour,
    resetCredits,
    message:
      codex === null && spark === null && codexFiveHour === null && sparkFiveHour === null
        ? "The Codex CLI session did not report supported usage limits."
        : null,
  };
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await NodeFSP.access(path, NodeFSP.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findCodexBinary(homePath: string): Promise<string | null> {
  const candidates = new Set<string>();
  const configured = process.env["CODEX_BINARY"]?.trim();
  if (configured) candidates.add(configured);
  for (const directory of (process.env["PATH"] ?? "").split(NodePath.delimiter)) {
    if (directory.trim().length > 0) candidates.add(NodePath.join(directory, "codex"));
  }
  candidates.add(NodePath.join(homePath, ".local/bin/codex"));
  candidates.add(NodePath.join(homePath, ".codex/bin/codex"));
  candidates.add("/opt/homebrew/bin/codex");
  candidates.add("/usr/local/bin/codex");

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function requestPlanUsage(
  binaryPath: string,
  cwd: string,
  clientVersion: string,
): Promise<unknown> {
  const child = NodeChildProcess.spawn(binaryPath, ["app-server", "--stdio"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = NodeReadline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map<
    number,
    { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
  >();
  let requestId = 0;
  let stderr = "";
  let finished = false;

  const fail = (error: Error) => {
    if (finished) return;
    for (const handler of pending.values()) handler.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-1200);
  });
  child.once("error", (error) => fail(error));
  child.once("exit", (code, signal) => {
    if (!finished) {
      const detail = stderr.trim().split("\n").at(-1);
      fail(
        new Error(detail || `Codex app-server exited (${signal ?? String(code ?? "unknown")}).`),
      );
    }
  });
  child.stdin.on("error", (error) => fail(error));
  lines.on("line", (line) => {
    let message: Record<string, unknown> | null = null;
    try {
      message = object(JSON.parse(line));
    } catch {
      return;
    }
    const id = finiteNumber(message?.["id"]);
    if (id === null || message?.["method"] !== undefined) return;
    const handler = pending.get(id);
    if (handler === undefined) return;
    pending.delete(id);
    const error = object(message?.["error"]);
    if (error !== null) {
      handler.reject(
        new Error(
          typeof error["message"] === "string" ? error["message"] : "Codex request failed.",
        ),
      );
    } else {
      handler.resolve(message?.["result"]);
    }
  });

  const request = (method: string, params: unknown) => {
    const id = ++requestId;
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const timeout = setTimeout(
    () => fail(new Error("Codex rate-limit request timed out.")),
    APP_SERVER_TIMEOUT_MS,
  );

  try {
    await request("initialize", {
      clientInfo: { name: "codex_usage", title: "Codex Usage", version: clientVersion },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const [account, limits] = await Promise.all([
      request("account/read", { refreshToken: false }),
      request("account/rateLimits/read", {}),
    ]);
    return { account, limits };
  } finally {
    finished = true;
    clearTimeout(timeout);
    lines.close();
    child.stdin.end();
    if (!child.killed) child.kill("SIGTERM");
  }
}

export class CodexRateLimitReader {
  readonly #homePath: string;
  readonly #clientVersion: string;
  #lastAvailable: CodexRateLimits | null = null;

  constructor(homePath: string, clientVersion: string) {
    this.#homePath = homePath;
    this.#clientVersion = clientVersion;
  }

  async read(nowMs = Date.now()): Promise<CodexRateLimits> {
    const readAt = new Date(nowMs).toISOString();
    const binaryPath = await findCodexBinary(this.#homePath);
    if (binaryPath === null) {
      return {
        status: "not-installed",
        readAt,
        planType: null,
        codex: null,
        spark: null,
        codexFiveHour: null,
        sparkFiveHour: null,
        resetCredits: null,
        message: "Codex CLI was not found. Set CODEX_BINARY to its executable path.",
      };
    }

    try {
      const result = parseRateLimitResponse(
        await requestPlanUsage(binaryPath, this.#homePath, this.#clientVersion),
        readAt,
      );
      if (result.status === "available") this.#lastAvailable = result;
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Codex rate limits are unavailable.";
      if (this.#lastAvailable !== null) {
        return { ...this.#lastAvailable, status: "stale", message };
      }
      return {
        status: "unavailable",
        readAt,
        planType: null,
        codex: null,
        spark: null,
        codexFiveHour: null,
        sparkFiveHour: null,
        resetCredits: null,
        message,
      };
    }
  }
}
