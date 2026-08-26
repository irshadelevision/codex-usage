import type { MenuBarDisplay } from "./types.ts";

export const MENU_BAR_DISPLAY_LABELS: Record<MenuBarDisplay, string> = {
  cost: "Estimated cost",
  tokens: "Processed tokens",
  sessions: "Sessions",
  "codex-weekly": "Codex usage % only",
  "codex-weekly-time": "Codex usage % + time left",
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
