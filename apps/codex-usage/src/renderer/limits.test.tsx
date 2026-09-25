import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { createSampleApi } from "./sampleData.ts";
import { UsageLimits } from "./App.tsx";
import { MenuBarView } from "./MenuBarView.tsx";
import type { UsageProvider } from "../shared/types.ts";

const state = vi.hoisted(() => ({ seeds: [] as unknown[] }));
vi.mock("./api.ts", () => ({ api: {} }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      actual.useState(state.seeds.length ? state.seeds.shift() : initial),
  };
});

describe("rendered provider limits", () => {
  it("puts Claude 5-hour before weekly, with descending remaining progress", async () => {
    const snapshot = await createSampleApi().getSnapshot();
    const html = renderToStaticMarkup(<UsageLimits snapshot={snapshot} provider="claude" />);
    expect(html.indexOf("Claude 5-hour")).toBeLessThan(html.indexOf("Claude weekly"));
    expect(html).toContain("has-five-hour");
    expect(html).toContain('aria-valuenow="75"');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain('style="width:75%"');
    expect(html).toContain('style="width:60%"');
    expect(html).not.toContain("Banked usage reset");
  });
  it("uses full width when only the weekly window exists", async () => {
    const source = await createSampleApi().getSnapshot();
    const snapshot = {
      ...source,
      claudeRateLimits: { ...source.claudeRateLimits, fiveHour: null },
    };
    const html = renderToStaticMarkup(<UsageLimits snapshot={snapshot} provider="claude" />);
    expect(html).toContain("Claude weekly");
    expect(html).not.toContain("Claude 5-hour");
    expect(html).not.toContain("has-five-hour");
  });
  it.each(["all", "codex", "claude"] as UsageProvider[])(
    "renders dropdown limits for %s and keeps controls outside scrolling content",
    async (provider) => {
      const api = createSampleApi();
      state.seeds = [
        await api.getSnapshot(),
        { ...(await api.getPreferences()), usageProvider: provider },
      ];
      const html = renderToStaticMarkup(<MenuBarView />);
      expect(html.includes('id="menu-limits-heading"')).toBe(provider !== "claude");
      expect(html.includes('id="menu-claude-limits-heading"')).toBe(provider !== "codex");
      expect(html).toContain('value="claude-five-hour-time"');
      expect(html).toContain('value="claude-limits-time"');
      if (provider !== "codex") {
        expect(html).toContain('aria-label="Claude 5-hour remaining"');
        expect(html).toContain('aria-label="Claude weekly remaining"');
      }
      expect(html).toContain('value="both-weekly-time"');
      expect(html).toContain('class="menu-bar-content"');
      expect(html).toContain('</section></div><footer class="menu-bar-footer">');
    },
  );
  it("renders missing-auth guidance instead of an invented 5-hour quota", async () => {
    const api = createSampleApi();
    const source = await api.getSnapshot();
    state.seeds = [
      {
        ...source,
        claudeRateLimits: {
          status: "unavailable",
          readAt: source.readAt,
          weekly: null,
          fiveHour: null,
          message: "Sign in with Claude Code",
        },
      },
      { ...(await api.getPreferences()), usageProvider: "claude" },
    ];
    const html = renderToStaticMarkup(<MenuBarView />);
    expect(html).toContain("Sign in with Claude Code");
    expect(html).not.toContain('aria-label="Claude 5-hour remaining"');
    expect(html).not.toContain("100% left");
  });
});
