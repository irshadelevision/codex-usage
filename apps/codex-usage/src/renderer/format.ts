import type { RangeSummary, UsageRange } from "../shared/types.ts";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat("en-US");

export function formatUsd(value: number): string {
  return USD.format(value);
}

export function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumSignificantDigits: 3,
  }).format(value);
}

export function formatCount(value: number): string {
  return INTEGER.format(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMode(value: string): string {
  if (value === "unknown") return "Unknown";
  if (value === "xhigh") return "Xhigh";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatWindow(summary: RangeSummary): string {
  if (summary.range === "24h") {
    const format = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `${format.format(new Date(summary.since))} – ${format.format(new Date(summary.until))}`;
  }
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${format.format(new Date(`${summary.since}T12:00:00`))} – ${format.format(new Date(`${summary.until}T12:00:00`))}`;
}

export function rangeLabel(range: UsageRange): string {
  if (range === "24h") return "24h";
  if (range === "7d") return "7 days";
  if (range === "30d") return "30 days";
  return "90 days";
}

export function formatPointLabel(key: string, range: UsageRange): string {
  const date = new Date(range === "24h" ? key : `${key}T12:00:00`);
  return new Intl.DateTimeFormat(
    "en-US",
    range === "24h" ? { hour: "numeric" } : { month: "short", day: "numeric" },
  ).format(date);
}

export function formatUpdatedAt(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (elapsed < 60_000) return "Updated just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

export function formatResetAt(value: string | null): string {
  if (value === null) return "Reset time unavailable";
  return `Resets ${new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}`;
}
