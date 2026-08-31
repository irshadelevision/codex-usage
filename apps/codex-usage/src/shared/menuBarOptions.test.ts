import { describe, expect, it } from "vite-plus/test";

import { menuBarDisplayFixedRange, menuBarDisplayUsesRange } from "./menuBarOptions.ts";

describe("menu bar display ranges", () => {
  it("maps each combined Codex status to its fixed cost range", () => {
    expect(menuBarDisplayFixedRange("codex-weekly-time-cost-7d")).toBe("7d");
    expect(menuBarDisplayFixedRange("codex-weekly-time-cost-30d")).toBe("30d");
    expect(menuBarDisplayFixedRange("codex-weekly-time-cost-90d")).toBe("90d");
  });

  it("keeps only user-selectable activity values tied to the range control", () => {
    expect(menuBarDisplayUsesRange("cost")).toBe(true);
    expect(menuBarDisplayUsesRange("codex-weekly-time-cost-30d")).toBe(false);
    expect(menuBarDisplayFixedRange("codex-weekly-time")).toBeNull();
  });
});
