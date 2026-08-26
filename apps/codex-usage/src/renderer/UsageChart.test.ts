import { describe, expect, it } from "vite-plus/test";

import { niceScale } from "./UsageChart.tsx";

describe("niceScale", () => {
  it("rounds the chart maximum above the usage peak", () => {
    const scale = niceScale(2.87, 4);
    expect(scale.max).toBeGreaterThanOrEqual(2.87);
    expect(scale.ticks[0]).toBe(0);
    expect(scale.ticks.at(-1)).toBe(scale.max);
  });

  it("falls back to a zero scale for invalid input", () => {
    expect(niceScale(Number.NaN, 4)).toEqual({ max: 0, ticks: [0] });
    expect(niceScale(10, 0)).toEqual({ max: 0, ticks: [0] });
  });
});
