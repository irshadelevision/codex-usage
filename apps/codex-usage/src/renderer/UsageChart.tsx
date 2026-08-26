import { useMemo, useState } from "react";

import type { RangeSummary, UsageMetric } from "../shared/types.ts";
import { formatPointLabel, formatTokens, formatUsd } from "./format.ts";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 250;
const PLOT_TOP = 8;
const TICK_COUNT = 4;

interface Point {
  readonly x: number;
  readonly y: number;
}

function monotoneTangents(points: readonly Point[]): readonly number[] {
  if (points.length < 2) return [0];
  const slopes = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1] ?? point;
    return next.x === point.x ? 0 : (next.y - point.y) / (next.x - point.x);
  });
  const tangents = Array.from({ length: points.length }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[tangents.length - 1] = slopes[slopes.length - 1] ?? 0;
  for (let index = 1; index < tangents.length - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }
  return tangents;
}

function curvePath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0]?.x ?? 0},${points[0]?.y ?? 0}`;
  const tangents = monotoneTangents(points);
  let path = `M${points[0]?.x.toFixed(2)},${points[0]?.y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    path += ` C${(from.x + dx / 3).toFixed(2)},${(from.y + ((tangents[index] ?? 0) * dx) / 3).toFixed(2)} ${(to.x - dx / 3).toFixed(2)},${(to.y - ((tangents[index + 1] ?? 0) * dx) / 3).toFixed(2)} ${to.x.toFixed(2)},${to.y.toFixed(2)}`;
  }
  return path;
}

export function niceScale(peak: number, count: number) {
  if (!Number.isFinite(peak) || peak <= 0 || !Number.isFinite(count) || count <= 0) {
    return { max: 0, ticks: [0] as readonly number[] };
  }
  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;
  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

export function UsageChart({
  summary,
  metric,
}: {
  readonly summary: RangeSummary;
  readonly metric: UsageMetric;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const format = metric === "cost" ? formatUsd : formatTokens;
  const { area, line, points, ticks, toY } = useMemo(() => {
    const values = summary.series.map((point) => {
      const value = metric === "cost" ? point.costUsd : point.totalTokens;
      return Number.isFinite(value) && value > 0 ? value : 0;
    });
    const peak = values.reduce((highest, value) => Math.max(highest, value), 0);
    const scale = niceScale(peak, TICK_COUNT);
    const toY = (value: number) =>
      scale.max === 0 ? VIEW_HEIGHT : VIEW_HEIGHT - (value / scale.max) * (VIEW_HEIGHT - PLOT_TOP);
    const step = values.length < 2 ? 0 : VIEW_WIDTH / (values.length - 1);
    const points = values.map((value, index) => ({ x: index * step, y: toY(value) }));
    const line = curvePath(points);
    return {
      line,
      area: line.length === 0 ? "" : `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`,
      points,
      ticks: scale.ticks,
      toY,
    };
  }, [metric, summary.series]);
  const hovered = hoverIndex === null ? undefined : summary.series[hoverIndex];
  const hoveredPoint = hoverIndex === null ? undefined : points[hoverIndex];
  const labelIndexes = [0, Math.floor((summary.series.length - 1) / 2), summary.series.length - 1];

  return (
    <div className="chart-shell">
      <div className="chart-body">
        <div className="chart-axis" aria-hidden>
          {ticks.map((tick) => (
            <span key={tick} style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}>
              {tick === 0 ? "0" : format(tick)}
            </span>
          ))}
        </div>
        <div
          className="chart-plot"
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (bounds.width === 0 || summary.series.length === 0) return;
            const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
            setHoverIndex(Math.round(fraction * (summary.series.length - 1)));
          }}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${summary.range === "24h" ? "Hourly" : "Daily"} ${metric} usage`}
          >
            {ticks.map((tick) => (
              <line
                key={tick}
                x1="0"
                x2={VIEW_WIDTH}
                y1={toY(tick)}
                y2={toY(tick)}
                className="chart-gridline"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={area} className="chart-area" />
            <path d={line} className="chart-line" vectorEffect="non-scaling-stroke" />
            {hoveredPoint === undefined ? null : (
              <>
                <line
                  x1={hoveredPoint.x}
                  x2={hoveredPoint.x}
                  y1={PLOT_TOP}
                  y2={VIEW_HEIGHT}
                  className="chart-crosshair"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={hoveredPoint.x}
                  cy={hoveredPoint.y}
                  r="4"
                  className="chart-point"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>
          {hovered === undefined ? null : (
            <div
              className="chart-tooltip"
              style={{
                left: `${((hoverIndex ?? 0) / Math.max(1, summary.series.length - 1)) * 100}%`,
                transform:
                  (hoverIndex ?? 0) / Math.max(1, summary.series.length - 1) > 0.7
                    ? "translateX(-100%)"
                    : "translateX(10px)",
              }}
            >
              <span>{formatPointLabel(hovered.key, summary.range)}</span>
              <strong>{format(metric === "cost" ? hovered.costUsd : hovered.totalTokens)}</strong>
            </div>
          )}
        </div>
      </div>
      <div className="chart-labels" aria-hidden>
        {labelIndexes.map((index) => (
          <span key={index}>
            {summary.series[index] === undefined
              ? ""
              : formatPointLabel(summary.series[index].key, summary.range)}
          </span>
        ))}
      </div>
    </div>
  );
}
