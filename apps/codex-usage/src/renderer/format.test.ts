import { describe, expect, it } from "vite-plus/test";

import {
  formatCount,
  formatCurrency,
  formatPercent,
  formatTokens,
  formatUpdatedAt,
} from "./format.ts";

describe("usage formatting", () => {
  it("keeps invalid numeric data from breaking the dashboard", () => {
    expect(formatCurrency(Number.NaN, "USD")).toBe("$0.00");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatCount(-12)).toBe("0");
    expect(formatPercent(Number.NaN)).toBe("0.0%");
    expect(formatPercent(2)).toBe("100.0%");
  });

  it("converts USD estimates to AED at the configured fixed rate", () => {
    expect(formatCurrency(10, "AED")).toBe("AED 36.73");
    expect(formatCurrency(10, "USD")).toBe("$10.00");
  });

  it("falls back for invalid timestamps", () => {
    expect(formatUpdatedAt("not-a-date")).toBe("Update time unavailable");
  });
});
