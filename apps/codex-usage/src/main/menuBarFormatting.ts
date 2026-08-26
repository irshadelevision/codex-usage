import { convertUsd } from "../shared/currency.ts";
import type { CodexWeeklyRateLimit, MenuBarDisplay, UsageCurrency } from "../shared/types.ts";
import {
  formatMenuBarReset,
  formatResetDateCompact,
  formatResetRemainingCompact,
} from "../shared/resetTime.ts";

export function formatMenuBarCurrency(valueUsd: number, currency: UsageCurrency): string {
  const value = convertUsd(Number.isFinite(valueUsd) ? valueUsd : 0, currency);
  const fractionDigits = value >= 100 ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
  return currency === "AED" ? `AED ${formatted}` : `$${formatted}`;
}

export type RateLimitStatusDisplay = "usage" | "usage-time" | "usage-date" | "time-date";

export function shouldShowMenuBarIcon(showMenuBarIcon: boolean, display: MenuBarDisplay): boolean {
  return showMenuBarIcon || display === "icon-only";
}

interface RectangleLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getMenuBarPopoverPosition(
  anchor: RectangleLike,
  workArea: RectangleLike,
  popover: Pick<RectangleLike, "width" | "height">,
  gap = 6,
): Point {
  const maximumX = workArea.x + Math.max(0, workArea.width - popover.width);
  const centeredX = anchor.x + anchor.width / 2 - popover.width / 2;
  const x = clamp(Math.round(centeredX), workArea.x, maximumX);

  const below = anchor.y + anchor.height + gap;
  const workAreaBottom = workArea.y + workArea.height;
  const above = anchor.y - popover.height - gap;
  const preferredY = below + popover.height <= workAreaBottom ? below : above;
  const maximumY = workArea.y + Math.max(0, workArea.height - popover.height);
  const y = clamp(Math.round(preferredY), workArea.y, maximumY);
  return { x, y };
}

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
