import type { MenuBarDisplay, UsageRange } from "./types.ts";

const MENU_BAR_DISPLAY_FIXED_RANGES: Partial<Record<MenuBarDisplay, UsageRange>> = {
  "codex-weekly-time-cost-7d": "7d",
  "codex-weekly-time-cost-30d": "30d",
  "codex-weekly-time-cost-90d": "90d",
  "claude-weekly-time-cost-7d": "7d",
  "claude-weekly-time-cost-30d": "30d",
  "claude-weekly-time-cost-90d": "90d",
  "claude-limits-time-cost-7d": "7d",
  "claude-limits-time-cost-30d": "30d",
  "claude-limits-time-cost-90d": "90d",
  "both-weekly-time-cost-7d": "7d",
  "both-weekly-time-cost-30d": "30d",
  "both-weekly-time-cost-90d": "90d",
};

export const MENU_BAR_DISPLAY_LABELS: Record<MenuBarDisplay, string> = {
  cost: "Estimated cost",
  tokens: "Processed tokens",
  sessions: "Sessions",
  "codex-weekly": "Codex weekly % left",
  "codex-weekly-time": "Codex weekly % left + time left",
  "codex-weekly-time-cost-7d": "Codex weekly % left + time left + 7-day cost",
  "codex-weekly-time-cost-30d": "Codex weekly % left + time left + 30-day cost",
  "codex-weekly-time-cost-90d": "Codex weekly % left + time left + 90-day cost",
  "codex-weekly-date": "Codex weekly % left + reset date",
  "codex-reset": "Codex weekly time left + reset date",
  "codex-five-hour": "Codex 5-hour % left",
  "codex-five-hour-time": "Codex 5-hour % left + time left",
  "codex-five-hour-date": "Codex 5-hour % left + reset date",
  "claude-weekly": "Claude weekly % left",
  "claude-weekly-time": "Claude weekly % left + time left",
  "claude-weekly-date": "Claude weekly % left + reset date",
  "claude-reset": "Claude weekly time left + reset date",
  "claude-five-hour": "Claude 5-hour % left",
  "claude-five-hour-time": "Claude 5-hour % left + time left",
  "claude-five-hour-date": "Claude 5-hour % left + reset date",
  "claude-five-hour-reset": "Claude 5-hour time left + reset date",
  "claude-limits": "Claude 5-hour + weekly % left",
  "claude-limits-time": "Claude 5-hour + weekly % left + time left",
  "claude-limits-date": "Claude 5-hour + weekly % left + reset date",
  "claude-limits-reset": "Claude 5-hour + weekly time left + reset date",
  "claude-limits-time-cost-7d": "Claude 5-hour + weekly + time left + 7-day cost",
  "claude-limits-time-cost-30d": "Claude 5-hour + weekly + time left + 30-day cost",
  "claude-limits-time-cost-90d": "Claude 5-hour + weekly + time left + 90-day cost",
  "claude-weekly-time-cost-7d": "Claude weekly % left + time left + 7-day cost",
  "claude-weekly-time-cost-30d": "Claude weekly % left + time left + 30-day cost",
  "claude-weekly-time-cost-90d": "Claude weekly % left + time left + 90-day cost",
  "both-weekly": "Codex + Claude weekly % left",
  "both-weekly-time": "Codex + Claude weekly % left + time left",
  "both-weekly-date": "Codex + Claude weekly % left + reset date",
  "both-five-hour-time": "Codex + Claude 5-hour % left + time left",
  "both-weekly-time-cost-7d": "Both weekly % left + time left + 7-day cost",
  "both-weekly-time-cost-30d": "Both weekly % left + time left + 30-day cost",
  "both-weekly-time-cost-90d": "Both weekly % left + time left + 90-day cost",
  "icon-only": "Icon only",
};

export function menuBarDisplayUsesRange(display: MenuBarDisplay): boolean {
  return display === "cost" || display === "tokens" || display === "sessions";
}

export function menuBarDisplayFixedRange(display: MenuBarDisplay): UsageRange | null {
  return MENU_BAR_DISPLAY_FIXED_RANGES[display] ?? null;
}
