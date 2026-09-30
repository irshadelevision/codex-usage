import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { CodexUsageScanner, readTranscript } from "./scanner.ts";

const now = Date.parse("2026-09-30T12:00:00Z");
const timestamp = "2026-09-30T10:00:00Z";
let directory: string;

beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-transcripts-"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

function codexLine(type: string, payload: Record<string, unknown>, time = timestamp): string {
  return JSON.stringify({ type, timestamp: time, payload });
}
function tokenLine(input: number, time = timestamp): string {
  return codexLine(
    "event_msg",
    {
      type: "token_count",
      info: { last_token_usage: { input_tokens: input, output_tokens: 10 } },
    },
    time,
  );
}
function codexTranscript(inputs = [100], time = timestamp): string {
  return (
    [
      codexLine("session_meta", { id: "session-1" }, time),
      codexLine("turn_context", { model: "example", effort: "high" }, time),
      ...inputs.map((input) => tokenLine(input, time)),
    ].join("\n") + "\n"
  );
}
function claudeLine(request = "request-1", extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    sessionId: "claude-session",
    requestId: request,
    message: { id: request, model: "example", usage: { input_tokens: 100, output_tokens: 10 } },
    ...extra,
  });
}
async function fixture() {
  const paths = {
    sessionsPath: NodePath.join(directory, "codex"),
    claudeProjectsPath: NodePath.join(directory, "claude"),
    scanCachePath: NodePath.join(directory, "scan.json"),
    ratesCachePath: NodePath.join(directory, "rates.json"),
  };
  await NodeFSP.mkdir(paths.sessionsPath);
  await NodeFSP.mkdir(paths.claudeProjectsPath);
  await NodeFSP.writeFile(
    paths.ratesCachePath,
    JSON.stringify({
      fetchedAtMs: now,
      document: { example: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } },
    }),
  );
  return paths;
}

describe("incremental transcript reader", () => {
  it("resumes appended Codex usage with its model, reasoning and duplicate state", async () => {
    const path = NodePath.join(directory, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript());
    const first = (await readTranscript(path, "codex"))!;
    expect(first.records).toHaveLength(1);
    expect(first.resumed).toBe(false);
    await NodeFSP.appendFile(path, tokenLine(100) + "\n" + tokenLine(200) + "\n");
    const second = (await readTranscript(path, "codex", first.position))!;
    expect(second.resumed).toBe(true);
    expect(second.records).toHaveLength(1);
    expect(second.records[0]).toMatchObject({
      model: "example",
      mode: "high",
      sessionId: "session-1",
      totals: { uncachedInputTokens: 200 },
    });
    expect(second.position.offset).toBe((await NodeFSP.stat(path)).size);
  });

  it("replays valid unterminated tails without committing their parser state", async () => {
    const path = NodePath.join(directory, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript().trimEnd());
    const first = (await readTranscript(path, "codex"))!;
    expect(first.records).toHaveLength(0);
    expect(first.tailRecords).toHaveLength(1);
    expect(first.position.codexState?.lastUsageSignature).toBeNull();
    await NodeFSP.appendFile(path, "\n" + tokenLine(200) + "\n");
    const second = (await readTranscript(path, "codex", first.position))!;
    expect(second.resumed).toBe(true);
    expect(second.records.map((record) => record.totals.uncachedInputTokens)).toEqual([100, 200]);
    expect(second.tailRecords).toHaveLength(0);
  });

  it("recovers an incomplete record and maintains byte offsets across Unicode and CRLF", async () => {
    const path = NodePath.join(directory, "session.jsonl");
    const prefix = codexTranscript([]).replaceAll("\n", "\r\n");
    const usage = JSON.stringify(JSON.parse(claudeLine("request-1", { text: "💻 العربية" })));
    await NodeFSP.writeFile(path, prefix + usage.slice(0, -10));
    const first = (await readTranscript(path, "claude"))!;
    expect(first.records).toHaveLength(0);
    expect(first.tailRecords).toHaveLength(0);
    expect(first.position.offset).toBe(Buffer.byteLength(prefix));
    await NodeFSP.appendFile(path, usage.slice(-10) + "\r\n");
    const second = (await readTranscript(path, "claude", first.position))!;
    expect(second.resumed).toBe(true);
    expect(second.records).toHaveLength(1);
    expect(second.position.offset).toBe((await NodeFSP.stat(path)).size);
  });

  it("fully reparses a growing rewrite if its resume guard no longer matches", async () => {
    const path = NodePath.join(directory, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript());
    const first = (await readTranscript(path, "codex"))!;
    await NodeFSP.writeFile(path, codexTranscript([900, 800]));
    const second = (await readTranscript(path, "codex", first.position))!;
    expect(second.resumed).toBe(false);
    expect(second.records.map((record) => record.totals.uncachedInputTokens)).toEqual([900, 800]);
  });

  it("fully reparses a truncated file and tolerates an empty or missing file", async () => {
    const path = NodePath.join(directory, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript([100, 200]));
    const first = (await readTranscript(path, "codex"))!;
    await NodeFSP.writeFile(path, codexTranscript([300]));
    const second = (await readTranscript(path, "codex", first.position))!;
    expect(second.resumed).toBe(false);
    expect(second.records[0]?.totals.uncachedInputTokens).toBe(300);
    await NodeFSP.writeFile(path, "");
    expect(await readTranscript(path, "codex")).toMatchObject({ records: [], tailRecords: [] });
    expect(await readTranscript(NodePath.join(directory, "missing"), "claude")).toBeNull();
  });

  it.each(["codex", "claude"] as const)(
    "keeps %s usage metadata in records larger than 8 MiB",
    async (provider) => {
      const path = NodePath.join(directory, "session.jsonl");
      const largeText = "x".repeat(8 * 1024 * 1024 + 1);
      await NodeFSP.writeFile(
        path,
        provider === "claude"
          ? claudeLine("large-request", { text: largeText }) + "\n"
          : codexTranscript([]) +
              codexLine("event_msg", {
                type: "token_count",
                info: { last_token_usage: { input_tokens: 100, output_tokens: 10 } },
                text: largeText,
              }) +
              "\n",
      );
      const parsed = (await readTranscript(path, provider))!;
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0]?.totals.uncachedInputTokens).toBe(100);
      expect(parsed.position.offset).toBe((await NodeFSP.stat(path)).size);
    },
  );
});

describe("persistent usage history", () => {
  // Root bypasses file permissions; Windows reports uid -1 and has no POSIX mode test.
  it.skipIf(NodeOS.userInfo().uid <= 0)(
    "preserves cached totals on a read failure and retries after recovery",
    async () => {
      const paths = await fixture();
      const path = NodePath.join(paths.sessionsPath, "session.jsonl");
      await NodeFSP.writeFile(path, codexTranscript());
      const scanner = new CodexUsageScanner(paths);
      await scanner.scan(now);
      await NodeFSP.appendFile(path, tokenLine(200) + "\n");
      await NodeFSP.chmod(path, 0);
      try {
        const failed = await scanner.scan(now);
        expect(failed.ranges["24h"]).toMatchObject({ records: 1, totalTokens: 110 });
        expect(failed.skippedFiles).toBe(1);
        const reloaded = await new CodexUsageScanner(paths).scan(now);
        expect(reloaded.ranges["24h"].records).toBe(1);
      } finally {
        await NodeFSP.chmod(path, 0o600);
      }
      expect((await scanner.scan(now)).ranges["24h"]).toMatchObject({
        records: 2,
        totalTokens: 320,
      });
    },
  );

  it("preserves both providers' usage after cleanup and an app restart", async () => {
    const paths = await fixture();
    const codexPath = NodePath.join(paths.sessionsPath, "session.jsonl");
    const claudePath = NodePath.join(paths.claudeProjectsPath, "session.jsonl");
    await NodeFSP.writeFile(codexPath, codexTranscript().trimEnd());
    await NodeFSP.writeFile(claudePath, claudeLine());
    const scanner = new CodexUsageScanner(paths);
    const first = await scanner.scan(now);
    await NodeFSP.unlink(codexPath);
    await NodeFSP.unlink(claudePath);
    const retained = await scanner.scan(now);
    const reloaded = await new CodexUsageScanner(paths).scan(now);
    for (const snapshot of [first, retained, reloaded]) {
      expect(snapshot.ranges["24h"]).toMatchObject({ records: 2, totalTokens: 220 });
      expect(snapshot.providerRanges.codex["24h"].records).toBe(1);
      expect(snapshot.providerRanges.claude["24h"].records).toBe(1);
      expect(snapshot.ranges["24h"].costUsd).toBeCloseTo(0.00024, 10);
    }
  });

  it("does not count moved or copied Codex sessions twice, including repeated A-B-A events", async () => {
    const paths = await fixture();
    const path = NodePath.join(paths.sessionsPath, "old.jsonl");
    const movedPath = NodePath.join(paths.sessionsPath, "moved.jsonl");
    const copyPath = NodePath.join(paths.sessionsPath, "copy.jsonl");
    await NodeFSP.writeFile(path, codexTranscript([100, 200, 100]));
    const scanner = new CodexUsageScanner(paths);
    expect((await scanner.scan(now)).ranges["24h"].records).toBe(3);
    await NodeFSP.rename(path, movedPath);
    await NodeFSP.copyFile(movedPath, copyPath);
    for (const snapshot of [
      await scanner.scan(now),
      await new CodexUsageScanner(paths).scan(now),
    ]) {
      expect(snapshot.ranges["24h"]).toMatchObject({ records: 3, totalTokens: 430, sessions: 1 });
    }
  });

  it("merges appended records and trailing records exactly once after restart", async () => {
    const paths = await fixture();
    const path = NodePath.join(paths.sessionsPath, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript().trimEnd());
    expect((await new CodexUsageScanner(paths).scan(now)).ranges["24h"].records).toBe(1);
    await NodeFSP.appendFile(path, "\n" + tokenLine(200));
    expect((await new CodexUsageScanner(paths).scan(now)).ranges["24h"].records).toBe(2);
    await NodeFSP.appendFile(path, "\n");
    const final = await new CodexUsageScanner(paths).scan(now);
    expect(final.ranges["24h"]).toMatchObject({ records: 2, totalTokens: 320 });
  });

  it("replaces cache on same-sized edits and shrinking rewrites", async () => {
    const paths = await fixture();
    const path = NodePath.join(paths.sessionsPath, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript([100, 200]));
    const scanner = new CodexUsageScanner(paths);
    await scanner.scan(now);
    await NodeFSP.writeFile(path, codexTranscript([300, 400]));
    await NodeFSP.utimes(path, now / 1000, now / 1000);
    expect((await scanner.scan(now)).ranges["24h"].totalTokens).toBe(720);
    await NodeFSP.writeFile(path, codexTranscript([500]));
    expect((await scanner.scan(now)).ranges["24h"].totalTokens).toBe(510);
  });

  it("retains custom-range history outside 90 days without leaking another source home", async () => {
    const paths = await fixture();
    const path = NodePath.join(paths.sessionsPath, "historical.jsonl");
    const historicalTime = "2025-01-01T12:00:00Z";
    await NodeFSP.writeFile(path, codexTranscript([100], historicalTime));
    await NodeFSP.utimes(
      path,
      Date.parse(historicalTime) / 1000,
      Date.parse(historicalTime) / 1000,
    );
    const custom = { start: "2025-01-01T00:00:00Z", end: "2025-01-02T00:00:00Z" };
    const scanner = new CodexUsageScanner(paths);
    expect((await scanner.scan(now, custom)).customSummary?.records).toBe(1);
    await NodeFSP.unlink(path);
    expect((await scanner.scan(now)).ranges["90d"].records).toBe(0);
    expect((await new CodexUsageScanner(paths).scan(now, custom)).customSummary?.records).toBe(1);
    const other = await new CodexUsageScanner({
      ...paths,
      sessionsPath: paths.sessionsPath + "-other",
    }).scan(now, custom);
    expect(other.customSummary?.records).toBe(0);
  });

  it("uses boundary-safe roots and never imports a sibling directory's cached records", async () => {
    const paths = await fixture();
    const sibling = paths.sessionsPath + "-other";
    await NodeFSP.mkdir(sibling);
    await NodeFSP.writeFile(NodePath.join(sibling, "session.jsonl"), codexTranscript());
    await new CodexUsageScanner({ ...paths, sessionsPath: sibling }).scan(now);
    const snapshot = await new CodexUsageScanner(paths).scan(now);
    expect(snapshot.ranges["24h"].records).toBe(0);
  });

  it("migrates version 3 history without erasing records from deleted transcripts", async () => {
    const paths = await fixture();
    const path = NodePath.join(paths.sessionsPath, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript());
    await new CodexUsageScanner(paths).scan(now);
    const cache = JSON.parse(await NodeFSP.readFile(paths.scanCachePath, "utf8"));
    cache.version = 3;
    for (const [, entry] of cache.entries) {
      delete entry.position;
      delete entry.tailRecords;
      delete entry.provider;
    }
    await NodeFSP.writeFile(paths.scanCachePath, JSON.stringify(cache));
    await NodeFSP.unlink(path);
    expect((await new CodexUsageScanner(paths).scan(now)).ranges["24h"].records).toBe(1);
    expect(JSON.parse(await NodeFSP.readFile(paths.scanCachePath, "utf8")).version).toBe(4);
  });

  it("prunes history older than the supported two-year range", async () => {
    const paths = await fixture();
    const path = NodePath.join(paths.sessionsPath, "expired.jsonl");
    await NodeFSP.writeFile(path, codexTranscript([100], "2024-09-01T12:00:00Z"));
    await new CodexUsageScanner(paths).scan(now);
    const cache = JSON.parse(await NodeFSP.readFile(paths.scanCachePath, "utf8"));
    cache.entries[0][1].mtimeMs = Date.parse("2024-09-01T12:00:00Z");
    await NodeFSP.writeFile(paths.scanCachePath, JSON.stringify(cache));
    await NodeFSP.unlink(path);
    await new CodexUsageScanner(paths).scan(now);
    expect(JSON.parse(await NodeFSP.readFile(paths.scanCachePath, "utf8")).entries).toHaveLength(0);
  });

  it("ignores corrupt resume state and safely falls back to a full read", async () => {
    const paths = await fixture();
    const path = NodePath.join(paths.sessionsPath, "session.jsonl");
    await NodeFSP.writeFile(path, codexTranscript());
    await new CodexUsageScanner(paths).scan(now);
    const cache = JSON.parse(await NodeFSP.readFile(paths.scanCachePath, "utf8"));
    cache.entries[0][1].position.codexState = { model: "example" };
    await NodeFSP.writeFile(paths.scanCachePath, JSON.stringify(cache));
    await NodeFSP.appendFile(path, tokenLine(200) + "\n");
    const result = await new CodexUsageScanner(paths).scan(now);
    expect(result.ranges["24h"]).toMatchObject({ records: 2, totalTokens: 320 });
  });

  it("retries a failed cache write even if no transcript changes", async () => {
    const paths = await fixture();
    const nestedCache = NodePath.join(directory, "unavailable", "scan.json");
    await NodeFSP.writeFile(NodePath.join(paths.sessionsPath, "session.jsonl"), codexTranscript());
    const scanner = new CodexUsageScanner({ ...paths, scanCachePath: nestedCache });
    expect((await scanner.scan(now)).ranges["24h"].records).toBe(1);
    await NodeFSP.mkdir(NodePath.dirname(nestedCache));
    await scanner.scan(now);
    expect(JSON.parse(await NodeFSP.readFile(nestedCache, "utf8")).entries).toHaveLength(1);
    await NodeFSP.unlink(NodePath.join(paths.sessionsPath, "session.jsonl"));
    const reloaded = new CodexUsageScanner({ ...paths, scanCachePath: nestedCache });
    expect((await reloaded.scan(now)).ranges["24h"].records).toBe(1);
  });
});
