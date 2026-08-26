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

  it("formats two-decimal display currencies at their configured rate", () => {
    expect(formatCurrency(10, "AED")).toBe("AED 36.73");
    expect(formatCurrency(10, "SAR")).toBe("SAR 37.50");
    expect(formatCurrency(10, "QAR")).toBe("QAR 36.40");
    expect(formatCurrency(10, "HKD")).toBe("HKD 78.00");
    expect(formatCurrency(10, "USD")).toBe("$10.00");
  });

  it("keeps three decimal places for dinar and rial display currencies", () => {
    expect(formatCurrency(10, "BHD")).toBe("BHD 3.760");
    expect(formatCurrency(10, "OMR")).toBe("OMR 3.850");
    expect(formatCurrency(10, "JOD")).toBe("JOD 7.100");
  });

  it("falls back for invalid timestamps", () => {
    expect(formatUpdatedAt("not-a-date")).toBe("Update time unavailable");
  });
});
