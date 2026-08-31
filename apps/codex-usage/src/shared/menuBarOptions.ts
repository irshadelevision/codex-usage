import type { MenuBarDisplay, UsageRange } from "./types.ts";

const MENU_BAR_DISPLAY_FIXED_RANGES: Partial<Record<MenuBarDisplay, UsageRange>> = {
  "codex-weekly-time-cost-7d": "7d",
  "codex-weekly-time-cost-30d": "30d",
  "codex-weekly-time-cost-90d": "90d",
};

export const MENU_BAR_DISPLAY_LABELS: Record<MenuBarDisplay, string> = {
  cost: "Estimated cost",
  tokens: "Processed tokens",
  sessions: "Sessions",
  "codex-weekly": "Codex usage % only",
  "codex-weekly-time": "Codex usage % + time left",
  "codex-weekly-time-cost-7d": "Codex usage % + time left + 7-day cost",
  "codex-weekly-time-cost-30d": "Codex usage % + time left + 30-day cost",
  "codex-weekly-time-cost-90d": "Codex usage % + time left + 90-day cost",
  "codex-weekly-date": "Codex usage % + reset date",
  "codex-reset": "Codex time left + reset date",
  "spark-weekly": "Spark usage % only",
  "spark-weekly-time": "Spark usage % + time left",
  "spark-weekly-date": "Spark usage % + reset date",
  "spark-reset": "Spark time left + reset date",
  "icon-only": "Icon only",
};

export function menuBarDisplayUsesRange(display: MenuBarDisplay): boolean {
  return display === "cost" || display === "tokens" || display === "sessions";
}

export function menuBarDisplayFixedRange(display: MenuBarDisplay): UsageRange | null {
  return MENU_BAR_DISPLAY_FIXED_RANGES[display] ?? null;
}
