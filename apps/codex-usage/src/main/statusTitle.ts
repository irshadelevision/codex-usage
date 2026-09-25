import type {
  MenuBarDisplay,
  RangeSummary,
  UsagePreferences,
  UsageSnapshot,
} from "../shared/types.ts";
import { menuBarDisplayFixedRange, menuBarDisplayUsesRange } from "../shared/menuBarOptions.ts";
import { usageRanges } from "../shared/providers.ts";
import {
  formatMenuBarCurrency,
  formatRateLimitStatus,
  type RateLimitStatusDisplay,
} from "./menuBarFormatting.ts";

const TOKEN_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});

function formatRangeDisplay(
  summary: RangeSummary,
  display: MenuBarDisplay,
  preferences: UsagePreferences,
  snapshot: UsageSnapshot,
): string {
  if (display === "tokens") return TOKEN_FORMAT.format(summary.totalTokens);
  if (display === "sessions") return new Intl.NumberFormat("en-US").format(summary.sessions);
  if (summary.records > 0 && summary.unpricedRecords === summary.records) return "—";
  return `${summary.unpricedRecords > 0 ? "≥ " : ""}${formatMenuBarCurrency(summary.costUsd, preferences.currency, snapshot.exchangeRates)}`;
}

export function usesCountdown(display: MenuBarDisplay): boolean {
  return display.includes("-time") || display.endsWith("-reset");
}

export function formatStatusTitle(
  snapshot: UsageSnapshot,
  preferences: UsagePreferences,
  nowMs: number,
): string {
  const display = preferences.menuBarDisplay;
  if (display === "icon-only") return "";
  if (menuBarDisplayUsesRange(display)) {
    return formatRangeDisplay(
      usageRanges(snapshot, preferences.usageProvider)[preferences.menuBarRange],
      display,
      preferences,
      snapshot,
    );
  }
  const provider = display.startsWith("both-")
    ? "all"
    : display.startsWith("claude-")
      ? "claude"
      : "codex";
  const fiveHour = display.includes("five-hour");
  const format: RateLimitStatusDisplay = display.endsWith("-reset")
    ? "time-date"
    : display.endsWith("-date")
      ? "usage-date"
      : usesCountdown(display)
        ? "usage-time"
        : "usage";
  const codexLimit = fiveHour ? snapshot.rateLimits.codexFiveHour : snapshot.rateLimits.codex;
  const claudeLimit = fiveHour
    ? snapshot.claudeRateLimits.fiveHour
    : snapshot.claudeRateLimits.weekly;
  const codex = `${formatRateLimitStatus(codexLimit, format, nowMs)}${snapshot.rateLimits.status === "stale" ? "*" : ""}`;
  const claude = `${formatRateLimitStatus(claudeLimit, format, nowMs)}${snapshot.claudeRateLimits.status === "stale" ? "*" : ""}`;
  const status =
    provider === "all"
      ? `Codex ${codex} | Claude ${claude}`
      : provider === "claude"
        ? claude
        : codex;
  const costRange = menuBarDisplayFixedRange(display);
  if (costRange === null) return status;
  const cost = formatRangeDisplay(
    usageRanges(snapshot, provider)[costRange],
    "cost",
    preferences,
    snapshot,
  );
  return `${status} · ${cost}`;
}
