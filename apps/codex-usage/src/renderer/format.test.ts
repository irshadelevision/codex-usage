import { describe, expect, it } from "vite-plus/test";

import { formatCount, formatPercent, formatTokens, formatUpdatedAt, formatUsd } from "./format.ts";

describe("usage formatting", () => {
  it("keeps invalid numeric data from breaking the dashboard", () => {
    expect(formatUsd(Number.NaN)).toBe("$0.00");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatCount(-12)).toBe("0");
    expect(formatPercent(Number.NaN)).toBe("0.0%");
    expect(formatPercent(2)).toBe("100.0%");
  });

  it("falls back for invalid timestamps", () => {
    expect(formatUpdatedAt("not-a-date")).toBe("Update time unavailable");
  });
});
