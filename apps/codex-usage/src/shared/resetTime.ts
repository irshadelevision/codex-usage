const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

const RESET_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const RESET_DATE_COMPACT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function resetTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function remainingParts(value: string | null, nowMs: number): string | null {
  const resetAtMs = resetTimestamp(value);
  if (resetAtMs === null) return null;
  const minutes = Math.max(0, Math.ceil((resetAtMs - nowMs) / MINUTE_MS));
  if (minutes === 0) return "Now";

  const days = Math.floor(minutes / DAY_MINUTES);
  const hours = Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES);
  if (days > 0) return hours === 0 ? `${days}d` : `${days}d ${hours}h`;

  const remainingMinutes = minutes % HOUR_MINUTES;
  if (hours > 0) return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
  return `${remainingMinutes}m`;
}

export function formatResetRemaining(value: string | null, nowMs: number): string {
  const remaining = formatResetRemainingCompact(value, nowMs);
  if (remaining === "—") return "Time remaining unavailable";
  return remaining === "Now" ? "Reset due now" : `${remaining} remaining`;
}

export function formatResetRemainingCompact(value: string | null, nowMs: number): string {
  return remainingParts(value, nowMs) ?? "—";
}

export function formatResetDateCompact(value: string | null): string {
  const resetAtMs = resetTimestamp(value);
  return resetAtMs === null ? "—" : RESET_DATE_COMPACT.format(resetAtMs);
}

export function formatResetDateTime(value: string | null): string {
  const resetAtMs = resetTimestamp(value);
  return resetAtMs === null
    ? "Reset date unavailable"
    : `Resets ${RESET_DATE_TIME.format(resetAtMs)}`;
}

export function formatMenuBarReset(value: string | null, nowMs: number): string {
  const remaining = formatResetRemainingCompact(value, nowMs);
  const date = formatResetDateCompact(value);
  if (remaining === "—" || date === "—") return "—";
  return `${remaining} · ${date}`;
}
