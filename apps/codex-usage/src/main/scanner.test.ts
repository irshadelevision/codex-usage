import { describe, expect, it } from "vite-plus/test";

import type { TokenTotals } from "../shared/types.ts";
import {
  aggregateRange,
  initialCodexScanState,
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
});
