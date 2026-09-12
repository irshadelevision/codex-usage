export interface CustomRange {
  readonly start: string;
  readonly end: string;
}

export function earliestCustomDate(nowMs = Date.now()): Date {
  const date = new Date(nowMs);
  date.setFullYear(date.getFullYear() - 2);
  date.setSeconds(0, 0);
  return date;
}

export function validateCustomRange(value: CustomRange, nowMs = Date.now()): CustomRange {
  const start = Date.parse(value?.start);
  const end = Date.parse(value?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error("Choose both dates and times.");
  if (start >= end) throw new Error("End must be after start.");
  if (start < earliestCustomDate(nowMs).getTime())
    throw new Error("Choose a start within the last two years.");
  if (end > nowMs) throw new Error("End cannot be in the future.");
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
