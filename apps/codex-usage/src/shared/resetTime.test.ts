import { describe, expect, it } from "vite-plus/test";

import {
  formatExpiryDateTime,
  formatExpiryRemaining,
  formatMenuBarReset,
  formatResetDateCompact,
  formatResetDateTime,
  formatResetRemaining,
  formatResetRemainingCompact,
} from "./resetTime.ts";

const nowMs = Date.parse("2026-08-26T12:00:00.000Z");

describe("reset time formatting", () => {
  it("formats a compact countdown and date for the menu bar", () => {
    expect(formatMenuBarReset("2026-08-28T16:30:00.000Z", nowMs)).toBe("2d 4h · Aug 28");
    expect(formatResetRemainingCompact("2026-08-28T16:30:00.000Z", nowMs)).toBe("2d 4h");
    expect(formatResetDateCompact("2026-08-28T16:30:00.000Z")).toBe("Aug 28");
  });

  it("formats a detailed countdown for weekly usage cards", () => {
    expect(formatResetRemaining("2026-08-26T15:12:00.000Z", nowMs)).toBe("3h 12m remaining");
    expect(formatResetRemaining("2026-08-26T12:00:00.000Z", nowMs)).toBe("Reset due now");
  });

  it("returns clear unavailable labels for missing or invalid reset times", () => {
    expect(formatResetRemaining(null, nowMs)).toBe("Time remaining unavailable");
    expect(formatResetDateTime("not-a-date")).toBe("Reset date unavailable");
    expect(formatMenuBarReset("not-a-date", nowMs)).toBe("—");
    expect(formatResetRemainingCompact(null, nowMs)).toBe("—");
    expect(formatResetDateCompact(null)).toBe("—");
    expect(formatExpiryRemaining(null, nowMs)).toBe("Expiration unavailable");
    expect(formatExpiryDateTime("not-a-date")).toBe("Expiration date unavailable");
  });

  it("formats banked reset expiration without implying the reset was used", () => {
    expect(formatExpiryRemaining("2026-08-28T16:30:00.000Z", nowMs)).toBe("Expires in 2d 4h");
    expect(formatExpiryRemaining("2026-08-26T12:00:00.000Z", nowMs)).toBe("Expired");
    expect(formatExpiryDateTime("2026-08-28T16:30:00.000Z")).toContain("Expires");
  });
});
