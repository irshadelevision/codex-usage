import { describe, expect, it } from "vite-plus/test";

import { formatMenuBarUsd, formatRateLimitStatus } from "./menuBarFormatting.ts";

describe("formatMenuBarUsd", () => {
  it("formats costs below 100 with cents", () => {
    expect(formatMenuBarUsd(42.5)).toBe("$42.50");
  });

  it("formats costs at or above 100 without an invalid fraction range", () => {
    expect(formatMenuBarUsd(100)).toBe("$100");
    expect(formatMenuBarUsd(1_234.56)).toBe("$1,235");
  });
});

describe("formatRateLimitStatus", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00.000Z");
  const limit = {
    limitId: "codex",
    name: "Codex plan",
    usedPercent: 42,
    remainingPercent: 58,
    resetsAt: "2026-08-28T16:30:00.000Z",
    windowDurationMins: 10_080,
  };

  it("supports every selectable usage and reset combination", () => {
    expect(formatRateLimitStatus(limit, "usage", nowMs)).toBe("58%");
    expect(formatRateLimitStatus(limit, "usage-time", nowMs)).toBe("58% · 2d 4h");
    expect(formatRateLimitStatus(limit, "usage-date", nowMs)).toBe("58% · Aug 28");
    expect(formatRateLimitStatus(limit, "time-date", nowMs)).toBe("2d 4h · Aug 28");
  });

  it("uses a compact unavailable marker when the bucket is missing", () => {
    expect(formatRateLimitStatus(null, "usage-time", nowMs)).toBe("—");
  });
});
