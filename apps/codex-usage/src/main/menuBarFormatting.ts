import { CURRENCY_FRACTION_DIGITS, convertUsd } from "../shared/currency.ts";
import type {
  CodexRateLimitWindow,
  ExchangeRateSnapshot,
  MenuBarDisplay,
  UsageCurrency,
} from "../shared/types.ts";
import {
  formatMenuBarReset,
  formatResetDateCompact,
  formatResetRemainingCompact,
} from "../shared/resetTime.ts";

const MENU_BAR_INTEGER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const MENU_BAR_TWO_DECIMAL = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const MENU_BAR_THREE_DECIMAL = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

function formatMenuBarNumber(value: number, fractionDigits: number): string {
  if (fractionDigits === 0) return MENU_BAR_INTEGER.format(value);
  return (fractionDigits === 3 ? MENU_BAR_THREE_DECIMAL : MENU_BAR_TWO_DECIMAL).format(value);
}

export function formatMenuBarCurrency(
  valueUsd: number,
  currency: UsageCurrency,
  exchangeRates?: ExchangeRateSnapshot,
): string {
  const value = convertUsd(Number.isFinite(valueUsd) ? valueUsd : 0, currency, exchangeRates);
  if (value === null) return `${currency} —`;
  const fractionDigits = value >= 100 ? 0 : CURRENCY_FRACTION_DIGITS[currency];
  const formatted = formatMenuBarNumber(value, fractionDigits);
  return currency === "USD" ? `$${formatted}` : `${currency} ${formatted}`;
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

export function getMenuBarPopoverHeight(workAreaHeight: number, preferredHeight: number): number {
  return Math.max(1, Math.min(Math.floor(workAreaHeight), preferredHeight));
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
  limit: CodexRateLimitWindow | null,
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

export function formatRateLimitStatusWithCost(
  limit: CodexRateLimitWindow | null,
  costUsd: number,
  currency: UsageCurrency,
  exchangeRates: ExchangeRateSnapshot,
  nowMs: number,
): string {
  const status = formatRateLimitStatus(limit, "usage-time", nowMs);
  const cost = formatMenuBarCurrency(costUsd, currency, exchangeRates);
  return `${status} · ${cost}`;
}
