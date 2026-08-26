import { CURRENCY_FRACTION_DIGITS, convertUsd } from "../shared/currency.ts";
import type {
  ExchangeRateSnapshot,
  RangeSummary,
  UsageCurrency,
  UsageRange,
} from "../shared/types.ts";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const TWO_DECIMAL_CURRENCY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const THREE_DECIMAL_CURRENCY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const ZERO_DECIMAL_CURRENCY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const INTEGER = new Intl.NumberFormat("en-US");
const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});
const WINDOW_WITH_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const WINDOW_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const POINT_HOUR = new Intl.DateTimeFormat("en-US", { hour: "numeric" });

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function formatCurrency(
  valueUsd: number,
  currency: UsageCurrency,
  exchangeRates?: ExchangeRateSnapshot,
): string {
  const value = convertUsd(finiteOrZero(valueUsd), currency, exchangeRates);
  if (value === null) return `${currency} —`;
  if (currency === "USD") return USD.format(value);
  const fractionDigits = CURRENCY_FRACTION_DIGITS[currency];
  const formatter =
    fractionDigits === 0
      ? ZERO_DECIMAL_CURRENCY
      : fractionDigits === 3
        ? THREE_DECIMAL_CURRENCY
        : TWO_DECIMAL_CURRENCY;
  const formatted = formatter.format(value);
  return `${currency} ${formatted}`;
}

export function formatTokens(value: number): string {
  return COMPACT.format(Math.max(0, finiteOrZero(value)));
}

export function formatCount(value: number): string {
  return INTEGER.format(Math.max(0, Math.round(finiteOrZero(value))));
}

export function formatPercent(value: number): string {
  return `${(Math.min(1, Math.max(0, finiteOrZero(value))) * 100).toFixed(1)}%`;
}

export function formatMode(value: string): string {
  if (value === "unknown") return "Unknown";
  if (value === "xhigh") return "Xhigh";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatWindow(summary: RangeSummary): string {
  if (summary.range === "24h") {
    return `${WINDOW_WITH_TIME.format(new Date(summary.since))} – ${WINDOW_WITH_TIME.format(new Date(summary.until))}`;
  }
  return `${WINDOW_DAY.format(new Date(`${summary.since}T12:00:00`))} – ${WINDOW_DAY.format(new Date(`${summary.until}T12:00:00`))}`;
}

export function rangeLabel(range: UsageRange): string {
  if (range === "24h") return "24h";
  if (range === "7d") return "7 days";
  if (range === "30d") return "30 days";
  return "90 days";
}

export function formatPointLabel(key: string, range: UsageRange): string {
  const date = new Date(range === "24h" ? key : `${key}T12:00:00`);
  return (range === "24h" ? POINT_HOUR : WINDOW_DAY).format(date);
}

export function formatUpdatedAt(value: string): string {
  const updatedAt = Date.parse(value);
  if (Number.isNaN(updatedAt)) return "Update time unavailable";
  const elapsed = Math.max(0, Date.now() - updatedAt);
  if (elapsed < 60_000) return "Updated just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}
