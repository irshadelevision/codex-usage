import { describe, expect, it } from "vite-plus/test";

import { parseRateLimitResponse } from "./rateLimits.ts";

describe("parseRateLimitResponse", () => {
  it("selects the five-hour and weekly Codex and Spark windows from the CLI session", () => {
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
                usedPercent: 12,
                windowDurationMins: 300,
                resetsAt: 1_790_000_000,
              },
              secondary: {
                usedPercent: 42,
                windowDurationMins: 10_080,
                resetsAt: 1_800_000_000,
              },
            },
            codex_bengalfox: {
              limitId: "codex_bengalfox",
              limitName: "GPT-5.3-Codex-Spark",
              primary: { usedPercent: 8, windowDurationMins: 300, resetsAt: 1_795_000_000 },
              secondary: { usedPercent: 18, windowDurationMins: 10_080 },
            },
          },
          rateLimitResetCredits: {
            availableCount: 1,
            credits: [
              {
                id: "opaque-credit-id",
                status: "available",
                resetType: "codexRateLimits",
                grantedAt: 1_780_000_000,
                expiresAt: 1_800_864_000,
                title: "Full reset",
              },
            ],
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
    expect(result.codexFiveHour).toMatchObject({
      limitId: "codex",
      usedPercent: 12,
      remainingPercent: 88,
      windowDurationMins: 300,
    });
    expect(result.sparkFiveHour).toMatchObject({
      limitId: "codex_bengalfox",
      usedPercent: 8,
      remainingPercent: 92,
      windowDurationMins: 300,
    });
    expect(result.resetCredits).toEqual({
      availableCount: 1,
      title: "Full reset",
      expiresAt: "2027-01-25T08:00:00.000Z",
    });
  });

  it("presents an exact five-hour window without treating it as weekly", () => {
    const result = parseRateLimitResponse(
      {
        rateLimits: { limitId: "codex", primary: { usedPercent: 5, windowDurationMins: 300 } },
      },
      "2026-08-26T12:00:00.000Z",
    );

    expect(result.status).toBe("available");
    expect(result.codex).toBeNull();
    expect(result.spark).toBeNull();
    expect(result.codexFiveHour).toMatchObject({
      usedPercent: 5,
      remainingPercent: 95,
      windowDurationMins: 300,
    });
    expect(result.sparkFiveHour).toBeNull();
    expect(result.resetCredits).toBeNull();
  });

  it("does not label another short rolling window as a five-hour limit", () => {
    const result = parseRateLimitResponse(
      {
        rateLimits: { limitId: "codex", primary: { usedPercent: 5, windowDurationMins: 240 } },
      },
      "2026-08-26T12:00:00.000Z",
    );

    expect(result.status).toBe("unavailable");
    expect(result.codex).toBeNull();
    expect(result.codexFiveHour).toBeNull();
    expect(result.sparkFiveHour).toBeNull();
  });

  it("keeps the authoritative reset count when detail rows are unavailable", () => {
    const result = parseRateLimitResponse(
      {
        rateLimitResetCredits: {
          availableCount: 3,
          credits: null,
        },
      },
      "2026-08-26T12:00:00.000Z",
    );

    expect(result.status).toBe("available");
    expect(result.resetCredits).toEqual({
      availableCount: 3,
      title: null,
      expiresAt: null,
    });
  });

  it("uses the nearest available reset expiry and omits unavailable credits", () => {
    const result = parseRateLimitResponse(
      {
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            { status: "used", expiresAt: 1_700_000_000, title: "Used reset" },
            { status: "available", expiresAt: 1_900_000_000, title: "Later reset" },
            { status: "available", expiresAt: 1_800_000_000, title: "Next reset" },
          ],
        },
      },
      "2026-08-26T12:00:00.000Z",
    );

    expect(result.resetCredits).toEqual({
      availableCount: 2,
      title: "Next reset",
      expiresAt: "2027-01-15T08:00:00.000Z",
    });
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
