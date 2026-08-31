import { describe, expect, it } from "vite-plus/test";

import {
  menuBarDisplayCostLimitSource,
  menuBarDisplayFixedRange,
  menuBarDisplayUsesRange,
} from "./menuBarOptions.ts";

describe("menu bar display ranges", () => {
  it("maps each cost status family to its fixed range", () => {
    expect(menuBarDisplayFixedRange("codex-weekly-time-cost-7d")).toBe("7d");
    expect(menuBarDisplayFixedRange("codex-weekly-time-cost-30d")).toBe("30d");
    expect(menuBarDisplayFixedRange("codex-weekly-time-cost-90d")).toBe("90d");
    expect(menuBarDisplayFixedRange("spark-weekly-time-cost-7d")).toBe("7d");
    expect(menuBarDisplayFixedRange("spark-weekly-time-cost-30d")).toBe("30d");
    expect(menuBarDisplayFixedRange("spark-weekly-time-cost-90d")).toBe("90d");
    expect(menuBarDisplayFixedRange("codex-spark-weekly-time-cost-7d")).toBe("7d");
    expect(menuBarDisplayFixedRange("codex-spark-weekly-time-cost-30d")).toBe("30d");
    expect(menuBarDisplayFixedRange("codex-spark-weekly-time-cost-90d")).toBe("90d");
  });

  it("maps cost statuses to the correct rate-limit source", () => {
    expect(menuBarDisplayCostLimitSource("codex-weekly-time-cost-7d")).toBe("codex");
    expect(menuBarDisplayCostLimitSource("spark-weekly-time-cost-30d")).toBe("spark");
    expect(menuBarDisplayCostLimitSource("codex-spark-weekly-time-cost-90d")).toBe("combined");
    expect(menuBarDisplayCostLimitSource("cost")).toBeNull();
  });

  it("keeps only user-selectable activity values tied to the range control", () => {
    expect(menuBarDisplayUsesRange("cost")).toBe(true);
    expect(menuBarDisplayUsesRange("spark-weekly-time-cost-30d")).toBe(false);
    expect(menuBarDisplayFixedRange("codex-spark-weekly-time")).toBeNull();
  });
});
