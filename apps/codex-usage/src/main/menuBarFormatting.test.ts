import { describe, expect, it } from "vite-plus/test";

import {
  formatMenuBarCurrency,
  formatRateLimitStatus,
  getMenuBarPopoverPosition,
  shouldShowMenuBarIcon,
} from "./menuBarFormatting.ts";

describe("formatMenuBarCurrency", () => {
  it("formats costs below 100 with cents", () => {
    expect(formatMenuBarCurrency(42.5, "USD")).toBe("$42.50");
    expect(formatMenuBarCurrency(10, "AED")).toBe("AED 36.73");
    expect(formatMenuBarCurrency(10, "BHD")).toBe("BHD 3.760");
    expect(formatMenuBarCurrency(10, "HKD")).toBe("HKD 78.00");
  });

  it("formats costs at or above 100 without an invalid fraction range", () => {
    expect(formatMenuBarCurrency(100, "USD")).toBe("$100");
    expect(formatMenuBarCurrency(1_234.56, "USD")).toBe("$1,235");
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

describe("shouldShowMenuBarIcon", () => {
  it("allows the icon to be hidden when a text value is displayed", () => {
    expect(shouldShowMenuBarIcon(false, "codex-weekly-time")).toBe(false);
    expect(shouldShowMenuBarIcon(true, "codex-weekly-time")).toBe(true);
  });

  it("keeps the status item reachable in icon-only mode", () => {
    expect(shouldShowMenuBarIcon(false, "icon-only")).toBe(true);
  });
});

describe("getMenuBarPopoverPosition", () => {
  const workArea = { x: 0, y: 24, width: 1_440, height: 876 };
  const popover = { width: 380, height: 640 };

  it("centers the popover beneath the status item", () => {
    expect(
      getMenuBarPopoverPosition({ x: 700, y: 0, width: 24, height: 24 }, workArea, popover),
    ).toEqual({ x: 522, y: 30 });
  });

  it("keeps the popover inside the display at either horizontal edge", () => {
    expect(
      getMenuBarPopoverPosition({ x: 4, y: 0, width: 24, height: 24 }, workArea, popover).x,
    ).toBe(0);
    expect(
      getMenuBarPopoverPosition({ x: 1_420, y: 0, width: 20, height: 24 }, workArea, popover).x,
    ).toBe(1_060);
  });

  it("opens above a bottom-positioned status item", () => {
    expect(
      getMenuBarPopoverPosition({ x: 700, y: 876, width: 24, height: 24 }, workArea, popover).y,
    ).toBe(230);
  });
});
