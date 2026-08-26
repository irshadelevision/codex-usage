import type { CodexWeeklyRateLimit } from "../shared/types.ts";
import {
  formatMenuBarReset,
  formatResetDateCompact,
  formatResetRemainingCompact,
} from "../shared/resetTime.ts";

export function formatMenuBarUsd(value: number): string {
  const fractionDigits = value >= 100 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export type RateLimitStatusDisplay = "usage" | "usage-time" | "usage-date" | "time-date";

export function formatRateLimitStatus(
  limit: CodexWeeklyRateLimit | null,
  display: RateLimitStatusDisplay,
  nowMs: number,
): string {
  if (limit === null) return "—";
  const usage = `${limit.remainingPercent}%`;
  if (display === "usage") return usage;

  const suffix =
    display === "usage-time"
      ? formatResetRemainingCompact(limit.resetsAt, nowMs)
      : display === "usage-date"
        ? formatResetDateCompact(limit.resetsAt)
        : formatMenuBarReset(limit.resetsAt, nowMs);
  if (suffix === "—") return "—";
  return display === "time-date" ? suffix : `${usage} · ${suffix}`;
}
