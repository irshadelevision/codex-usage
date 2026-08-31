import { describe, expect, it } from "vite-plus/test";

import type { ExchangeRateSnapshot } from "../shared/types.ts";
import {
  formatCombinedRateLimitStatus,
  formatCombinedRateLimitStatusWithCost,
  formatMenuBarCurrency,
  formatRateLimitStatus,
  formatRateLimitStatusWithCost,
  getMenuBarPopoverHeight,
  getMenuBarPopoverPosition,
  shouldShowMenuBarIcon,
} from "./menuBarFormatting.ts";

const exchangeRates: ExchangeRateSnapshot = {
  status: "fresh",
  source: "Frankfurter",
  fetchedAt: "2026-08-27T00:00:00.000Z",
  rates: { GBP: 0.73383, INR: 95.48 },
  rateDates: { GBP: "2026-08-26", INR: "2026-08-26" },
  message: null,
};

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

  it("uses live rates and remains compact when a rate is unavailable", () => {
    expect(formatMenuBarCurrency(10, "GBP", exchangeRates)).toBe("GBP 7.34");
    expect(formatMenuBarCurrency(10, "INR", exchangeRates)).toBe("INR 955");
    expect(formatMenuBarCurrency(10, "RUB", exchangeRates)).toBe("RUB —");
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

describe("formatRateLimitStatusWithCost", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00.000Z");
  const limit = {
    limitId: "codex",
    name: "Codex plan",
    usedPercent: 42,
    remainingPercent: 58,
    resetsAt: "2026-08-28T16:30:00.000Z",
    windowDurationMins: 10_080,
  };

  it("combines usage, time left, and cost in the selected currency", () => {
    expect(formatRateLimitStatusWithCost(limit, 10, "USD", exchangeRates, nowMs)).toBe(
      "58% · 2d 4h · $10.00",
    );
    expect(formatRateLimitStatusWithCost(limit, 10, "GBP", exchangeRates, nowMs)).toBe(
      "58% · 2d 4h · GBP 7.34",
    );
  });

  it("keeps the selected range cost visible when the limit is unavailable", () => {
    expect(formatRateLimitStatusWithCost(null, 42.5, "USD", exchangeRates, nowMs)).toBe(
      "— · $42.50",
    );
  });
});

describe("formatCombinedRateLimitStatus", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00.000Z");
  const codexLimit = {
    limitId: "codex",
    name: "Codex plan",
    usedPercent: 42,
    remainingPercent: 58,
    resetsAt: "2026-08-28T16:30:00.000Z",
    windowDurationMins: 10_080,
  };
  const sparkLimit = {
    limitId: "spark",
    name: "Spark plan",
    usedPercent: 25,
    remainingPercent: 75,
    resetsAt: "2026-08-27T16:00:00.000Z",
    windowDurationMins: 10_080,
  };

  it("labels both usage buckets and their individual countdowns", () => {
    expect(formatCombinedRateLimitStatus(codexLimit, sparkLimit, nowMs)).toBe(
      "C 58% · 2d 4h | S 75% · 1d 4h",
    );
  });

  it("keeps missing buckets explicit", () => {
    expect(formatCombinedRateLimitStatus(codexLimit, null, nowMs)).toBe("C 58% · 2d 4h | S —");
  });

  it("appends one overall range cost in the selected currency", () => {
    expect(
      formatCombinedRateLimitStatusWithCost(
        codexLimit,
        sparkLimit,
        10,
        "GBP",
        exchangeRates,
        nowMs,
      ),
    ).toBe("C 58% · 2d 4h | S 75% · 1d 4h | GBP 7.34");
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
  const popover = { width: 390, height: 724 };

  it("centers the popover beneath the status item", () => {
    expect(
      getMenuBarPopoverPosition({ x: 700, y: 0, width: 24, height: 24 }, workArea, popover),
    ).toEqual({ x: 517, y: 30 });
  });

  it("keeps the popover inside the display at either horizontal edge", () => {
    expect(
      getMenuBarPopoverPosition({ x: 4, y: 0, width: 24, height: 24 }, workArea, popover).x,
    ).toBe(0);
    expect(
      getMenuBarPopoverPosition({ x: 1_420, y: 0, width: 20, height: 24 }, workArea, popover).x,
    ).toBe(1_050);
  });

  it("opens above a bottom-positioned status item", () => {
    expect(
      getMenuBarPopoverPosition({ x: 700, y: 876, width: 24, height: 24 }, workArea, popover).y,
    ).toBe(146);
  });
});

describe("getMenuBarPopoverHeight", () => {
  it("uses the full preferred height when it fits", () => {
    expect(getMenuBarPopoverHeight(876, 724)).toBe(724);
  });

  it("clamps the popover to a shorter display work area", () => {
    expect(getMenuBarPopoverHeight(640, 724)).toBe(640);
  });
});
