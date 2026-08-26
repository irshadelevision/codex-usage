import { CheckIcon, RefreshCwIcon, SettingsIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  BreakdownKind,
  CodexWeeklyRateLimit,
  CodexUsageApi,
  MenuBarDisplay,
  RangeSummary,
  UsageMetric,
  UsagePreferences,
  UsagePreferencesPatch,
  UsageRange,
  UsageSnapshot,
} from "../shared/types.ts";
import { MENU_BAR_DISPLAYS, USAGE_RANGES } from "../shared/types.ts";
import {
  formatCount,
  formatMode,
  formatPercent,
  formatResetAt,
  formatTokens,
  formatUpdatedAt,
  formatUsd,
  formatWindow,
  rangeLabel,
} from "./format.ts";
import { createSampleApi } from "./sampleData.ts";
import { UsageChart } from "./UsageChart.tsx";

const api: CodexUsageApi = window.codexUsage ?? createSampleApi();

const METRICS = ["cost", "tokens"] as const;
const BREAKDOWNS = ["models", "modes"] as const;

const MENU_BAR_DISPLAY_LABELS: Record<MenuBarDisplay, string> = {
  cost: "Estimated cost",
  tokens: "Processed tokens",
  sessions: "Sessions",
  "codex-weekly": "Codex weekly remaining",
  "spark-weekly": "Spark weekly remaining",
  "icon-only": "Icon only",
};

function menuBarDisplayUsesRange(display: MenuBarDisplay): boolean {
  return display === "cost" || display === "tokens" || display === "sessions";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unknown operation failure";
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  optionLabel,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly T[];
  readonly value: T;
  readonly optionLabel: (option: T) => string;
  readonly onChange: (option: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "selected" : undefined}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {optionLabel(option)}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function SettingsPopover({
  preferences,
  onClose,
  onUpdate,
}: {
  readonly preferences: UsagePreferences;
  readonly onClose: () => void;
  readonly onUpdate: (patch: UsagePreferencesPatch) => void;
}) {
  const rangeEnabled = menuBarDisplayUsesRange(preferences.menuBarDisplay);
  return (
    <div id="usage-settings" className="settings-popover" role="dialog" aria-label="Usage settings">
      <div className="settings-heading">
        <strong>Menu bar</strong>
        <button
          type="button"
          className="icon-button quiet"
          aria-label="Close settings"
          onClick={onClose}
        >
          <XIcon size={14} />
        </button>
      </div>
      <ToggleRow
        label="Show in Menu Bar"
        checked={preferences.showInMenuBar}
        onChange={(showInMenuBar) => onUpdate({ showInMenuBar })}
      />
      <ToggleRow
        label="Launch at Login"
        checked={preferences.launchAtLogin}
        onChange={(launchAtLogin) => onUpdate({ launchAtLogin })}
      />
      <label className="settings-select-row">
        <span className={rangeEnabled ? undefined : "disabled-label"}>Displayed range</span>
        <select
          value={preferences.menuBarRange}
          disabled={!rangeEnabled}
          onChange={(event) => onUpdate({ menuBarRange: event.target.value as UsageRange })}
        >
          {USAGE_RANGES.map((range) => (
            <option key={range} value={range}>
              {rangeLabel(range)}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-select-row">
        <span>Displayed value</span>
        <select
          value={preferences.menuBarDisplay}
          onChange={(event) => onUpdate({ menuBarDisplay: event.target.value as MenuBarDisplay })}
        >
          {MENU_BAR_DISPLAYS.map((display) => (
            <option key={display} value={display}>
              {MENU_BAR_DISPLAY_LABELS[display]}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-note">Click the status item to open the native usage menu.</p>
    </div>
  );
}

function WeeklyLimitCard({
  label,
  limit,
}: {
  readonly label: string;
  readonly limit: CodexWeeklyRateLimit | null;
}) {
  const usedPercent = limit?.usedPercent ?? 0;
  return (
    <article className={`rate-limit-card${limit === null ? " unavailable" : ""}`}>
      <div className="rate-limit-copy">
        <span>{label}</span>
        <strong>{limit === null ? "—" : `${limit.remainingPercent}%`}</strong>
        <small>{limit === null ? "Not reported for this account" : "remaining this week"}</small>
      </div>
      <div className="rate-limit-detail">
        <div
          className="rate-limit-track"
          role="progressbar"
          aria-label={`${label} weekly usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedPercent}
        >
          <i style={{ width: `${usedPercent}%` }} />
        </div>
        <span>{limit === null ? "Weekly limit unavailable" : formatResetAt(limit.resetsAt)}</span>
      </div>
    </article>
  );
}

function WeeklyLimits({ snapshot }: { readonly snapshot: UsageSnapshot }) {
  const limits = snapshot.rateLimits;
  const status =
    limits.status === "stale"
      ? "Last known values"
      : limits.planType === null
        ? "Reported by Codex"
        : `${limits.planType.replaceAll("_", " ")} plan`;
  return (
    <section className="panel rate-limits-panel" aria-labelledby="rate-limits-heading">
      <div className="rate-limits-heading">
        <div>
          <h2 id="rate-limits-heading">Weekly usage</h2>
          <p>Separate buckets reported by your signed-in Codex CLI session.</p>
        </div>
        <span>{status}</span>
      </div>
      <div className="rate-limits-grid">
        <WeeklyLimitCard label="Codex usage" limit={limits.codex} />
        <WeeklyLimitCard label="Spark usage" limit={limits.spark} />
      </div>
      {limits.message === null ? null : <p className="rate-limit-message">{limits.message}</p>}
    </section>
  );
}

function MetricBlock({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="metric-block">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail === undefined ? null : <small>{detail}</small>}
    </div>
  );
}

function Totals({ summary }: { readonly summary: RangeSummary }) {
  const total = Math.max(1, summary.totalTokens);
  const entries = [
    ["Processed tokens", summary.totalTokens, 1],
    ["Cached input", summary.totals.cachedInputTokens, summary.totals.cachedInputTokens / total],
    [
      "Uncached input",
      summary.totals.uncachedInputTokens,
      summary.totals.uncachedInputTokens / total,
    ],
    ["Output", summary.totals.outputTokens, summary.totals.outputTokens / total],
    ["Reasoning", summary.totals.reasoningTokens, summary.totals.reasoningTokens / total],
  ] as const;
  return (
    <section className="panel totals-panel" aria-labelledby="totals-heading">
      <h2 id="totals-heading">Totals</h2>
      <div className="totals-grid">
        {entries.map(([label, value, share]) => (
          <MetricBlock
            key={label}
            label={label}
            value={formatTokens(value)}
            detail={formatPercent(share)}
          />
        ))}
        <MetricBlock
          label="Cache savings"
          value={formatUsd(summary.cacheSavingsUsd)}
          detail="API estimate"
        />
      </div>
    </section>
  );
}

function BreakdownTable({
  summary,
  kind,
  metric,
}: {
  readonly summary: RangeSummary;
  readonly kind: BreakdownKind;
  readonly metric: UsageMetric;
}) {
  const rows = useMemo(() => {
    const source = kind === "models" ? summary.models : summary.modes;
    return source.toSorted((left, right) =>
      metric === "cost"
        ? right.costUsd - left.costUsd || right.totalTokens - left.totalTokens
        : right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
    );
  }, [kind, metric, summary.models, summary.modes]);
  const largestShare = rows.reduce(
    (highest, row) => Math.max(highest, metric === "cost" ? row.costShare : row.tokenShare),
    0,
  );

  return (
    <div className="table-wrap">
      <table>
        <colgroup>
          <col className="name-column" />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>{kind === "models" ? "Model" : "Mode"}</th>
            <th className="numeric">Cost</th>
            <th>Share</th>
            <th className="numeric">Tokens</th>
            <th className="numeric">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-row">
                No Codex activity in this range.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const share = metric === "cost" ? row.costShare : row.tokenShare;
              return (
                <tr key={row.key}>
                  <td className="row-name">{kind === "modes" ? formatMode(row.key) : row.key}</td>
                  <td className="numeric strong-cell">{formatUsd(row.costUsd)}</td>
                  <td>
                    <div className="share-cell">
                      <span>{formatPercent(share)}</span>
                      <i
                        style={{
                          width: `${largestShare === 0 ? 0 : (share / largestShare) * 100}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td className="numeric">{formatTokens(row.totalTokens)}</td>
                  <td className="numeric">{formatCount(row.sessions)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function LoadingView() {
  return (
    <main className="content loading-view" aria-label="Scanning Codex usage">
      <div className="loading-title" />
      <div className="loading-panel" />
      <div className="loading-strip" />
      <div className="loading-table" />
    </main>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <main className="content error-view">
      <div className="error-icon">
        <XIcon size={18} />
      </div>
      <h1>Usage could not be read</h1>
      <p>{message}</p>
      <button type="button" className="primary-button" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [preferences, setPreferences] = useState<UsagePreferences | null>(null);
  const [range, setRange] = useState<UsageRange>("7d");
  const [metric, setMetric] = useState<UsageMetric>("cost");
  const [breakdown, setBreakdown] = useState<BreakdownKind>("models");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribeSnapshot = api.onSnapshot((value) => {
      if (active) {
        setSnapshot(value);
        setError(null);
      }
    });
    const unsubscribePreferences = api.onPreferences((value) => {
      if (active) setPreferences(value);
    });
    void Promise.all([api.getSnapshot(), api.getPreferences()])
      .then(([nextSnapshot, nextPreferences]) => {
        if (!active) return;
        setSnapshot(nextSnapshot);
        setPreferences(nextPreferences);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
      unsubscribeSnapshot();
      unsubscribePreferences();
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  const refresh = () => {
    setRefreshing(true);
    setError(null);
    void api
      .refresh()
      .then((value) => {
        setSnapshot(value);
        setError(null);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setRefreshing(false));
  };
  const updatePreferences = (patch: UsagePreferencesPatch) => {
    void api
      .updatePreferences(patch)
      .then((value) => {
        setPreferences(value);
        setError(null);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  if (error !== null && (snapshot === null || preferences === null)) {
    return <ErrorView message={error} onRetry={refresh} />;
  }
  if (snapshot === null || preferences === null) return <LoadingView />;

  const summary = snapshot.ranges[range];
  const primaryValue =
    metric === "cost" ? formatUsd(summary.costUsd) : formatTokens(summary.totalTokens);
  const primaryLabel = metric === "cost" ? "API estimate" : "Processed tokens";
  const secondaryValue =
    metric === "cost" ? formatTokens(summary.totalTokens) : formatUsd(summary.costUsd);
  const secondaryLabel = metric === "cost" ? "Processed tokens" : "API estimate";

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-copy">
          <h1>Codex Usage</h1>
          <span>{formatWindow(summary)}</span>
        </div>
        <div className="titlebar-controls">
          <SegmentedControl
            label="Usage metric"
            options={METRICS}
            value={metric}
            optionLabel={(value) => (value === "cost" ? "Cost" : "Tokens")}
            onChange={setMetric}
          />
          <SegmentedControl
            label="Usage range"
            options={USAGE_RANGES}
            value={range}
            optionLabel={rangeLabel}
            onChange={setRange}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={refreshing ? "Refreshing usage" : "Refresh usage"}
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCwIcon size={16} />
          </button>
          <div className="settings-anchor">
            <button
              type="button"
              className={`icon-button${settingsOpen ? " active" : ""}`}
              aria-label="Usage settings"
              aria-expanded={settingsOpen}
              aria-controls="usage-settings"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <SettingsIcon size={16} />
            </button>
            {settingsOpen ? (
              <SettingsPopover
                preferences={preferences}
                onClose={() => setSettingsOpen(false)}
                onUpdate={updatePreferences}
              />
            ) : null}
          </div>
        </div>
      </header>

      <main className="content">
        {error === null ? null : (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        <section className="panel overview-panel" aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="sr-only">
            Usage overview
          </h2>
          <div className="overview-metrics">
            <MetricBlock
              label={primaryLabel}
              value={primaryValue}
              detail={metric === "cost" ? "Total cost" : "All processed tokens"}
            />
            <MetricBlock
              label="Sessions"
              value={formatCount(summary.sessions)}
              detail={`${formatCount(summary.records)} responses`}
            />
            <MetricBlock
              label={secondaryLabel}
              value={secondaryValue}
              detail={
                summary.unpricedRecords === 0
                  ? "All records priced"
                  : `${formatCount(summary.unpricedRecords)} unpriced responses`
              }
            />
          </div>
          <div className="chart-heading">
            <h2>
              {range === "24h" ? "Hourly" : "Daily"}{" "}
              {metric === "cost" ? "cost" : "processed tokens"}
            </h2>
            <span>
              {refreshing
                ? "Refreshing…"
                : `${formatCount(snapshot.scannedFiles)} transcript files`}
            </span>
          </div>
          <UsageChart summary={summary} metric={metric} />
        </section>

        <WeeklyLimits snapshot={snapshot} />

        <Totals summary={summary} />

        <section className="panel breakdown-panel" aria-labelledby="breakdown-heading">
          <div className="section-heading">
            <h2 id="breakdown-heading">Breakdown</h2>
            <SegmentedControl
              label="Usage breakdown"
              options={BREAKDOWNS}
              value={breakdown}
              optionLabel={(value) => (value === "models" ? "Models" : "Modes")}
              onChange={setBreakdown}
            />
          </div>
          <BreakdownTable summary={summary} kind={breakdown} metric={metric} />
        </section>

        <footer className="status-footer">
          <span className="scan-status">
            <CheckIcon size={12} /> Scanned {snapshot.sourcePath}
          </span>
          <i />
          <span>{formatUpdatedAt(snapshot.readAt)}</span>
          <i />
          <span>{snapshot.scanDurationMs}ms</span>
          <span className="pricing-status">Pricing {snapshot.pricing.status}</span>
        </footer>
      </main>
    </div>
  );
}
