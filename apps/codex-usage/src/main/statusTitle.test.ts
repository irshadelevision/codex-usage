import { describe, expect, it } from "vite-plus/test";
import { createSampleApi } from "../renderer/sampleData.ts";
import { MENU_BAR_DISPLAYS } from "../shared/types.ts";
import { MENU_BAR_DISPLAY_LABELS, menuBarDisplayFixedRange } from "../shared/menuBarOptions.ts";
import { formatStatusTitle, usesCountdown } from "./statusTitle.ts";

describe("provider-aware menu bar titles", () => {
  it("uses Claude's selected window, independently of the activity provider", async () => {
    const api = createSampleApi();
    const snapshot = await api.getSnapshot();
    const preferences = await api.getPreferences();
    const now = Date.parse(snapshot.readAt);
    expect(
      formatStatusTitle(
        snapshot,
        { ...preferences, usageProvider: "codex", menuBarDisplay: "claude-five-hour-time" },
        now,
      ),
    ).toBe("75% · 3h");
    expect(
      formatStatusTitle(snapshot, { ...preferences, menuBarDisplay: "claude-weekly-time" }, now),
    ).toBe("60% · 4d");
    expect(
      formatStatusTitle(
        snapshot,
        { ...preferences, menuBarDisplay: "claude-five-hour-reset" },
        now,
      ),
    ).toContain("3h · ");
  });
  it("labels combined quotas without averaging them", async () => {
    const api = createSampleApi();
    const snapshot = await api.getSnapshot();
    const preferences = await api.getPreferences();
    const title = formatStatusTitle(
      snapshot,
      { ...preferences, menuBarDisplay: "both-weekly-time" },
      Date.parse(snapshot.readAt),
    );
    expect(title).toMatch(/^Codex \d+% .+ \| Claude 60% · 4d$/);
  });
  it("keeps a known percentage when the reset date is missing, and marks stale values", async () => {
    const api = createSampleApi();
    const source = await api.getSnapshot();
    const preferences = await api.getPreferences();
    const snapshot = {
      ...source,
      claudeRateLimits: {
        ...source.claudeRateLimits,
        status: "stale" as const,
        fiveHour: { ...source.claudeRateLimits.fiveHour!, resetsAt: null },
      },
    };
    expect(
      formatStatusTitle(
        snapshot,
        { ...preferences, menuBarDisplay: "claude-five-hour-time" },
        Date.now(),
      ),
    ).toBe("75% · —*");
    expect(
      formatStatusTitle(
        {
          ...snapshot,
          claudeRateLimits: { ...snapshot.claudeRateLimits, fiveHour: null, status: "unavailable" },
        },
        { ...preferences, menuBarDisplay: "claude-five-hour" },
        Date.now(),
      ),
    ).toBe("—");
  });
  it("uses provider-matched cost totals instead of the activity selector", async () => {
    const api = createSampleApi();
    const source = await api.getSnapshot();
    const preferences = await api.getPreferences();
    const snapshot = {
      ...source,
      providerRanges: {
        ...source.providerRanges,
        claude: {
          ...source.providerRanges.claude,
          "7d": { ...source.providerRanges.claude["7d"], costUsd: 12.5 },
        },
      },
    };
    expect(
      formatStatusTitle(
        snapshot,
        { ...preferences, usageProvider: "codex", menuBarDisplay: "claude-weekly-time-cost-7d" },
        Date.parse(snapshot.readAt),
      ),
    ).toBe("60% · 4d · $12.50");
  });
  it("covers every selectable label, title, fixed range and countdown", async () => {
    const api = createSampleApi();
    const snapshot = await api.getSnapshot();
    const preferences = await api.getPreferences();
    for (const display of MENU_BAR_DISPLAYS) {
      expect(MENU_BAR_DISPLAY_LABELS[display]).toBeTruthy();
      const title = formatStatusTitle(
        snapshot,
        { ...preferences, menuBarDisplay: display },
        Date.parse(snapshot.readAt),
      );
      if (display === "icon-only") expect(title).toBe("");
      else expect(title).not.toMatch(/NaN|undefined/);
      if (display.includes("-cost-")) expect(menuBarDisplayFixedRange(display)).not.toBeNull();
      if (display.includes("-time") || display.endsWith("-reset"))
        expect(usesCountdown(display)).toBe(true);
    }
  });
});
