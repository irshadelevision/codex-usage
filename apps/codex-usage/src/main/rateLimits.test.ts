import { describe, expect, it } from "vite-plus/test";

import { parseRateLimitResponse } from "./rateLimits.ts";

describe("parseRateLimitResponse", () => {
  it("selects the weekly Codex and Spark windows from the CLI session", () => {
    const result = parseRateLimitResponse(
      {
        account: {
          account: { type: "chatgpt", planType: "pro" },
        },
        limits: {
          rateLimits: {
            limitId: "codex",
            planType: "pro",
            primary: { usedPercent: 42, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
          },
          rateLimitsByLimitId: {
            codex: {
              limitId: "codex",
              primary: {
                usedPercent: 42,
                windowDurationMins: 10_080,
                resetsAt: 1_800_000_000,
              },
            },
            codex_bengalfox: {
              limitId: "codex_bengalfox",
              limitName: "GPT-5.3-Codex-Spark",
              primary: { usedPercent: 18, windowDurationMins: 10_080 },
            },
          },
        },
      },
      "2026-08-26T12:00:00.000Z",
    );

    expect(result.status).toBe("available");
    expect(result.planType).toBe("pro");
    expect(result.codex).toMatchObject({
      limitId: "codex",
      name: "Codex plan",
      usedPercent: 42,
      remainingPercent: 58,
    });
    expect(result.spark).toMatchObject({
      limitId: "codex_bengalfox",
      name: "GPT-5.3-Codex-Spark",
      usedPercent: 18,
      remainingPercent: 82,
    });
  });

  it("does not present a short rolling window as a weekly limit", () => {
    const result = parseRateLimitResponse(
      {
        rateLimits: { limitId: "codex", primary: { usedPercent: 5, windowDurationMins: 300 } },
      },
      "2026-08-26T12:00:00.000Z",
    );

    expect(result.status).toBe("unavailable");
    expect(result.codex).toBeNull();
    expect(result.spark).toBeNull();
  });

  it("ignores an invalid reset timestamp without failing the refresh", () => {
    const result = parseRateLimitResponse(
      {
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 12,
            windowDurationMins: 10_080,
            resetsAt: Number.MAX_VALUE,
          },
        },
      },
      "2026-08-26T12:00:00.000Z",
    );

    expect(result.status).toBe("available");
    expect(result.codex?.resetsAt).toBeNull();
  });
});
