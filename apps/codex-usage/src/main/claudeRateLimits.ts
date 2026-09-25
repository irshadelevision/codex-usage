import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";
import type { ClaudeRateLimits, CodexRateLimitWindow } from "../shared/types.ts";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const RETRY_MS = 5 * 60_000;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface Credential {
  readonly accessToken: string;
  readonly expiresAt: number | null;
  readonly scopes: readonly string[] | null;
}

export function parseClaudeCredential(raw: string): Credential | null {
  try {
    const oauth = object(object(JSON.parse(raw))?.claudeAiOauth);
    if (typeof oauth?.accessToken !== "string" || !oauth.accessToken.trim()) return null;
    return {
      accessToken: oauth.accessToken,
      expiresAt:
        typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt)
          ? oauth.expiresAt
          : null,
      scopes: Array.isArray(oauth.scopes)
        ? oauth.scopes.filter((scope): scope is string => typeof scope === "string")
        : null,
    };
  } catch {
    return null;
  }
}

// Read only the selected Claude Code profile. Never refresh or rewrite its rotating tokens.
export async function readClaudeCredential(homePath: string): Promise<Credential | null> {
  const configured = process.env["CLAUDE_CONFIG_DIR"]?.trim();
  const configPath = configured || NodePath.join(homePath, ".claude");
  let keychain: Credential | null = null;
  if (NodeProcess.platform === "darwin") {
    const suffix = configured
      ? `-${NodeCrypto.createHash("sha256").update(configured.normalize("NFC")).digest("hex").slice(0, 8)}`
      : "";
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/security",
        ["find-generic-password", "-s", `Claude Code-credentials${suffix}`, "-w"],
        { timeout: 5_000, maxBuffer: 1024 * 1024 },
      );
      keychain = parseClaudeCredential(stdout);
      if (keychain && (keychain.expiresAt === null || keychain.expiresAt > Date.now()))
        return keychain;
    } catch {
      // Missing/locked/denied keychain: use only this profile's native credential file.
    }
  }
  try {
    return (
      parseClaudeCredential(
        await NodeFSP.readFile(NodePath.join(configPath, ".credentials.json"), "utf8"),
      ) ?? keychain
    );
  } catch {
    return keychain;
  }
}

function parseWindow(value: unknown, name: string, minutes: number): CodexRateLimitWindow | null {
  const window = object(value);
  if (typeof window?.utilization !== "number" || !Number.isFinite(window.utilization)) return null;
  const usedPercent = Math.round(Math.max(0, Math.min(100, window.utilization)));
  const resetMs = typeof window.resets_at === "string" ? Date.parse(window.resets_at) : Number.NaN;
  return {
    limitId: `claude-${minutes}`,
    name,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null,
    windowDurationMins: minutes,
  };
}

export function parseClaudeUsage(value: unknown, readAt: string): ClaudeRateLimits {
  const payload = object(value);
  const fiveHour = parseWindow(payload?.five_hour, "Claude 5-hour", 300);
  const weekly = parseWindow(payload?.seven_day, "Claude weekly", 10_080);
  const available = fiveHour !== null || weekly !== null;
  return {
    status: available ? "available" : "unavailable",
    readAt,
    fiveHour,
    weekly,
    message: available ? null : "Claude did not report 5-hour or weekly limits for this account.",
  };
}

interface ReaderOptions {
  readonly credential: () => Promise<Credential | null>;
  readonly fetchUsage?: typeof fetch;
}

export class ClaudeRateLimitReader {
  readonly #options: ReaderOptions;
  #last: ClaudeRateLimits | null = null;
  #owner: string | null = null;
  #nextRead = 0;
  #inFlight: Promise<ClaudeRateLimits> | null = null;

  constructor(options: ReaderOptions) {
    this.#options = options;
  }

  read(nowMs = Date.now(), force = false): Promise<ClaudeRateLimits> {
    if (this.#inFlight) return this.#inFlight;
    if (this.#last && nowMs < this.#nextRead && !force) return Promise.resolve(this.#last);
    this.#inFlight = this.#read(nowMs).finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #read(nowMs: number): Promise<ClaudeRateLimits> {
    const readAt = new Date(nowMs).toISOString();
    this.#nextRead = nowMs + RETRY_MS;
    const unavailable = (message: string): ClaudeRateLimits => {
      this.#last = { status: "unavailable", readAt, fiveHour: null, weekly: null, message };
      return this.#last;
    };
    try {
      const credential = await this.#options.credential();
      if (!credential) {
        this.#owner = null;
        return unavailable(
          "Sign in with Claude Code (claude auth login), then refresh. Allow access to Claude Code-credentials if macOS asks.",
        );
      }
      const owner = NodeCrypto.createHash("sha256").update(credential.accessToken).digest("hex");
      // Never retain a previous account's quotas after a token/account change.
      if (owner !== this.#owner) this.#last = null;
      this.#owner = owner;
      if (credential.expiresAt !== null && credential.expiresAt <= nowMs) {
        return unavailable(
          "Claude Code sign-in has expired. Open Claude Code to renew it, then refresh.",
        );
      }
      if (credential.scopes && !credential.scopes.includes("user:profile")) {
        return unavailable(
          "Claude usage access requires claude auth login. A setup-token or API key cannot read plan limits.",
        );
      }
      const response = await (this.#options.fetchUsage ?? fetch)(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403) {
        return unavailable(
          "Claude rejected usage access. Sign in again with claude auth login, then refresh.",
        );
      }
      if (!response.ok) throw new Error("usage-unavailable");
      this.#last = parseClaudeUsage(await response.json(), readAt);
      return this.#last;
    } catch {
      // Do not expose upstream errors, response bodies, subprocess output, or credentials over IPC.
      const message =
        "Claude limits could not be refreshed. Check your connection and try again in a few minutes.";
      if (this.#last?.status === "available" || this.#last?.status === "stale") {
        this.#last = { ...this.#last, status: "stale", message };
        return this.#last;
      }
      return unavailable(message);
    }
  }
}
