import { useEffect, useState } from "react";
import {
  earliestCustomDate,
  validateCustomRange,
  type CustomRange,
} from "../shared/customRange.ts";
import type { RangeSummary } from "../shared/types.ts";
import { api } from "./api.ts";

function localInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function useCustomUsage(readAt?: string) {
  const [range, setRange] = useState<CustomRange | null>(null);
  const [summary, setSummary] = useState<RangeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setError(null);
    setLoading(range !== null);
    if (range) {
      void api
        .getCustomSummary(range)
        .then((value) => {
          if (active) setSummary(value);
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [range, readAt]);
  const selectedSummary =
    range && summary?.since === range.start && summary.until === range.end ? summary : null;
  return {
    range,
    summary: selectedSummary,
    error: range ? error : null,
    loading: range !== null && loading,
    setRange,
  };
}

export function CustomRangePicker({
  onApply,
  loading,
  error,
  active,
}: {
  readonly onApply: (range: CustomRange) => void;
  readonly loading: boolean;
  readonly error: string | null;
  readonly active: boolean;
}) {
  const [start, setStart] = useState(() => localInput(new Date(Date.now() - 86_400_000)));
  const [end, setEnd] = useState(() => localInput(new Date()));
  const [validation, setValidation] = useState<string | null>(null);
  return (
    <details className="custom-range-picker">
      <summary>{active ? "Custom range selected" : "Custom date & time"}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const checked = validateCustomRange({ start, end });
            setValidation(null);
            onApply(checked);
          } catch (cause) {
            setValidation(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <p>Local time · last two years · end time excluded</p>
        <label>
          Start
          <input
            required
            type="datetime-local"
            value={start}
            min={localInput(earliestCustomDate())}
            max={localInput(new Date())}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          End
          <input
            required
            type="datetime-local"
            value={end}
            min={start}
            max={localInput(new Date())}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Reading history…" : "Apply range"}
        </button>
        {validation ? <p role="alert">{validation}</p> : null}
      </form>
      {loading ? <p role="status">Reading selected history…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
