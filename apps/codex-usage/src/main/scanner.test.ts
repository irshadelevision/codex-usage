import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import type { TokenTotals } from "../shared/types.ts";
import {
  aggregateRange,
  CodexUsageScanner,
  deduplicateUsage,
  initialCodexScanState,
  parseClaudeLine,
  parseCodexLine,
  type UsageRecord,
} from "./scanner.ts";
import type { RateTable } from "./pricing.ts";

const modelRate = {
  inputCostPerToken: 1e-6,
  outputCostPerToken: 8e-6,
  cacheReadCostPerToken: 1e-7,
  cacheCreationCostPerToken: 1e-6,
};
const rates: RateTable = new Map([
  ["gpt-5.6-sol", modelRate],
  ["gpt-5.6-terra", modelRate],
]);

function line(type: string, timestamp: string, payload: Record<string, unknown>) {
  return JSON.stringify({ type, timestamp, payload });
}

function tokenLine(timestamp: string, totals: Record<string, number>) {
  return line("event_msg", timestamp, {
    type: "token_count",
    info: { last_token_usage: totals },
  });
}

describe("parseCodexLine", () => {
  it("carries the model and reasoning effort into usage records", () => {
    const state = initialCodexScanState();
    parseCodexLine(
      line("session_meta", "2026-08-26T10:00:00.000Z", {
        type: "session_meta",
        id: "session-1",
      }),
      state,
    );
    parseCodexLine(
      line("turn_context", "2026-08-26T10:00:01.000Z", {
        type: "turn_context",
        model: "gpt-5.6-sol",
        effort: "xhigh",
      }),
      state,
    );
    const record = parseCodexLine(
      tokenLine("2026-08-26T10:00:05.000Z", {
        input_tokens: 1_000,
        cached_input_tokens: 600,
        cache_write_input_tokens: 100,
        output_tokens: 200,
        reasoning_output_tokens: 80,
      }),
      state,
    );

    expect(record).toMatchObject({
      model: "gpt-5.6-sol",
      mode: "xhigh",
      sessionId: "session-1",
      totals: {
        uncachedInputTokens: 300,
        cachedInputTokens: 600,
        cacheCreationTokens: 100,
        outputTokens: 200,
        reasoningTokens: 80,
      },
    });
  });

  it("drops a repeated token delta", () => {
    const state = initialCodexScanState();
    parseCodexLine(
      line("turn_context", "2026-08-26T10:00:01.000Z", {
        type: "turn_context",
        model: "gpt-5.6-sol",
        effort: "low",
      }),
      state,
    );
    const usage = tokenLine("2026-08-26T10:00:05.000Z", {
      input_tokens: 100,
      output_tokens: 20,
    });
    expect(parseCodexLine(usage, state)).not.toBeNull();
    expect(parseCodexLine(usage, state)).toBeNull();
  });

  it("keeps identical token totals from separate turns", () => {
    const state = initialCodexScanState();
    const context = line("turn_context", "2026-08-26T10:00:01.000Z", {
      type: "turn_context",
      model: "gpt-5.6-sol",
      effort: "low",
    });
    const first = tokenLine("2026-08-26T10:00:05.000Z", {
      input_tokens: 100,
      output_tokens: 20,
    });
    const second = tokenLine("2026-08-26T10:05:05.000Z", {
      input_tokens: 100,
      output_tokens: 20,
    });

    parseCodexLine(context, state);
    expect(parseCodexLine(first, state)).not.toBeNull();
    expect(parseCodexLine(first, state)).toBeNull();
    parseCodexLine(context, state);
    expect(parseCodexLine(second, state)).not.toBeNull();
  });
});

function claudeLine(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-26T10:00:00Z",
    sessionId: "session-a",
    requestId: "request-a",
    message: {
      id: "message-a",
      model: "claude-example",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_creation: { ephemeral_1h_input_tokens: 20 },
        output_tokens: 30,
        speed: "fast",
      },
    },
    ...overrides,
  });
}

describe("Claude usage", () => {
  it("keeps input, cache reads, and cache writes as separate token classes", () => {
    const parsed = parseClaudeLine(claudeLine({ costUSD: 0.025 }));
    expect(parsed).toMatchObject({
      provider: "claude",
      model: "claude-example",
      fast: true,
      reportedCostUsd: 0.025,
      totals: {
        uncachedInputTokens: 100,
        cachedInputTokens: 200,
        cacheCreationTokens: 50,
        cacheCreationOneHourTokens: 20,
        outputTokens: 30,
        reasoningTokens: 0,
      },
    });
    const summary = aggregateRange(
      [parsed!],
      "7d",
      Date.parse("2026-08-26T12:00:00Z"),
      "UTC",
      new Map(),
    );
    expect(summary.totalTokens).toBe(380);
    expect(summary.costUsd).toBe(0.025);
    expect(summary.unpricedRecords).toBe(0);
  });

  it("deduplicates repeated content blocks across files but preserves distinct requests", () => {
    const first = parseClaudeLine(claudeLine())!;
    const copied = parseClaudeLine(claudeLine({ sessionId: "copied-session" }))!;
    const next = parseClaudeLine(claudeLine({ requestId: "request-b" }))!;
    expect(deduplicateUsage([first, copied, next])).toEqual([first, next]);
    expect(
      deduplicateUsage([
        { ...first, dedupeKey: null },
        { ...next, dedupeKey: null },
      ]),
    ).toHaveLength(2);
  });

  it("ignores synthetic errors, non-assistant records and malformed input", () => {
    for (const line of [
      "not json",
      "null",
      claudeLine({ type: "user" }),
      claudeLine({ timestamp: "invalid" }),
      claudeLine({ message: { model: "<synthetic>", usage: { output_tokens: 5 } } }),
      claudeLine({ message: { model: "claude-example", usage: {} } }),
    ]) {
      expect(parseClaudeLine(line)).toBeNull();
    }
  });

  it("reports missing model costs without dropping tokens", () => {
    const summary = aggregateRange(
      [parseClaudeLine(claudeLine())!],
      "7d",
      Date.parse("2026-08-26T12:00:00Z"),
      "UTC",
      new Map(),
    );
    expect(summary).toMatchObject({ records: 1, unpricedRecords: 1, totalTokens: 380, costUsd: 0 });
    expect(summary.models[0]).toMatchObject({ pricedRecords: 0, unpricedRecords: 1 });
  });
});

describe("multi-provider scanner", () => {
  it("separates provider totals, includes subagents, and preserves deduplication after cache reload", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-providers-"));
    const paths = {
      sessionsPath: NodePath.join(directory, "codex"),
      claudeProjectsPath: NodePath.join(directory, "claude"),
      scanCachePath: NodePath.join(directory, "scan.json"),
      ratesCachePath: NodePath.join(directory, "rates.json"),
    };
    const now = Date.parse("2026-08-26T12:00:00Z");
    try {
      await NodeFSP.mkdir(paths.sessionsPath);
      await NodeFSP.mkdir(NodePath.join(paths.claudeProjectsPath, "project", "subagents"), {
        recursive: true,
      });
      await NodeFSP.writeFile(
        paths.ratesCachePath,
        JSON.stringify({
          fetchedAtMs: now,
          document: {
            "gpt-5.6-sol": { input_cost_per_token: 1e-6, output_cost_per_token: 8e-6 },
            "claude-example": { input_cost_per_token: 3e-6, output_cost_per_token: 15e-6 },
          },
        }),
      );
      await NodeFSP.writeFile(
        NodePath.join(paths.sessionsPath, "session.jsonl"),
        [
          line("session_meta", "2026-08-26T09:00:00Z", { id: "session-a" }),
          line("turn_context", "2026-08-26T09:00:00Z", { model: "gpt-5.6-sol" }),
          tokenLine("2026-08-26T09:01:00Z", { input_tokens: 100, output_tokens: 20 }),
        ].join("\n"),
      );
      await NodeFSP.writeFile(
        NodePath.join(paths.claudeProjectsPath, "project", "session.jsonl"),
        claudeLine(),
      );
      await NodeFSP.writeFile(
        NodePath.join(paths.claudeProjectsPath, "project", "subagents", "agent.jsonl"),
        [claudeLine(), claudeLine({ requestId: "request-b" }), "invalid json"].join("\n"),
      );
      const first = await new CodexUsageScanner(paths).scan(now);
      const reloaded = await new CodexUsageScanner(paths).scan(now);
      for (const snapshot of [first, reloaded]) {
        expect(snapshot.providerRanges.codex["24h"]).toMatchObject({
          records: 1,
          totalTokens: 120,
        });
        expect(snapshot.providerRanges.claude["24h"]).toMatchObject({
          records: 2,
          totalTokens: 760,
        });
        expect(snapshot.ranges["24h"]).toMatchObject({ records: 3, totalTokens: 880, sessions: 2 });
        expect(snapshot.ranges["24h"].costUsd).toBeCloseTo(
          snapshot.providerRanges.codex["24h"].costUsd +
            snapshot.providerRanges.claude["24h"].costUsd,
        );
      }
      const custom = await new CodexUsageScanner(paths).scan(
        now,
        { start: "2026-08-26T09:30:00Z", end: "2026-08-26T11:00:00Z" },
        "claude",
      );
      expect(custom.customSummary).toMatchObject({ records: 2, totalTokens: 760 });
      const missing = await new CodexUsageScanner({
        ...paths,
        claudeProjectsPath: NodePath.join(directory, "missing"),
      }).scan(now);
      expect(missing.providerRanges.claude["24h"].records).toBe(0);
      expect(missing.ranges["24h"].records).toBe(1);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
});

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  const totals: TokenTotals = {
    uncachedInputTokens: 100,
    cachedInputTokens: 500,
    cacheCreationTokens: 0,
    outputTokens: 50,
    reasoningTokens: 20,
  };
  return {
    timestampMs: Date.parse("2026-08-26T10:10:00.000Z"),
    model: "gpt-5.6-sol",
    mode: "high",
    sessionId: "session-a",
    totals,
    ...overrides,
  };
}

describe("aggregateRange", () => {
  it("builds model and mode breakdowns without adding reasoning twice", () => {
    const summary = aggregateRange(
      [
        record(),
        record({ timestampMs: Date.parse("2026-08-26T10:11:00.000Z") }),
        record({ mode: "low", sessionId: "session-b" }),
        record({ model: "gpt-5.6-terra", mode: "high", sessionId: "session-c" }),
      ],
      "7d",
      Date.parse("2026-08-26T12:00:00.000Z"),
      "UTC",
      rates,
    );

    expect(summary.totalTokens).toBe(2_600);
    expect(summary.totals.reasoningTokens).toBe(80);
    expect(summary.sessions).toBe(3);
    expect(summary.models).toHaveLength(2);
    expect(summary.models.find(({ model }) => model === "gpt-5.6-sol")?.sessions).toBe(2);
    expect(summary.modes.map(({ model, mode }) => `${model}:${mode}`).toSorted()).toEqual([
      "gpt-5.6-sol:high",
      "gpt-5.6-sol:low",
      "gpt-5.6-terra:high",
    ]);
    expect(
      summary.modes.find(({ model, mode }) => model === "gpt-5.6-sol" && mode === "high")?.sessions,
    ).toBe(1);
    expect(summary.series).toHaveLength(7);
    expect(summary.costUsd).toBeGreaterThan(0);
  });

  it("uses 24 fixed buckets for the rolling daily view", () => {
    const summary = aggregateRange(
      [record()],
      "24h",
      Date.parse("2026-08-26T12:37:42.000Z"),
      "UTC",
      rates,
    );
    expect(summary.series).toHaveLength(24);
    expect(summary.since).toBe("2026-08-25T12:37:00.000Z");
    expect(summary.until).toBe("2026-08-26T12:37:00.000Z");
  });

  it("filters exact custom boundaries and includes historical records", () => {
    const start = "2025-01-01T12:30:00.000Z";
    const end = "2025-01-01T14:00:00.000Z";
    const summary = aggregateRange(
      [-1, 0, 1, 90 * 60_000].map((offset) => record({ timestampMs: Date.parse(start) + offset })),
      "90d",
      Date.parse("2026-09-12T12:00:00Z"),
      "UTC",
      rates,
      { start, end },
    );
    expect(summary.records).toBe(2);
    expect(summary.range).toBe("custom");
    expect(summary.series).toHaveLength(2);
    expect(summary.series.reduce((sum, point) => sum + point.costUsd, 0)).toBeCloseTo(
      summary.costUsd,
    );
  });

  it("uses daily buckets for two years and respects local day boundaries", () => {
    const start = "2024-09-12T00:00:00Z";
    const end = "2026-09-12T00:00:00Z";
    const summary = aggregateRange(
      [record({ timestampMs: Date.parse("2025-01-01T22:00:00Z") })],
      "90d",
      Date.parse(end),
      "Asia/Dubai",
      rates,
      { start, end },
    );
    expect(summary.series.length).toBeLessThanOrEqual(732);
    expect(summary.series.find((point) => point.key === "2025-01-02")?.costUsd).toBeGreaterThan(0);
    expect(summary.records).toBe(1);
  });
});
