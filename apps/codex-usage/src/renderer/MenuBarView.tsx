import { ArrowUpRightIcon, InfoIcon, PowerIcon, RefreshCwIcon, Settings2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import appIconUrl from "../../build/icon.png";
import {
  USAGE_CURRENCY_GROUPS,
  USAGE_CURRENCY_LABELS,
  usageCurrencyRateNote,
} from "../shared/currency.ts";
import { MENU_BAR_DISPLAY_LABELS, menuBarDisplayUsesRange } from "../shared/menuBarOptions.ts";
import {
  formatExpiryDateTime,
  formatExpiryRemaining,
  formatResetDateTime,
  formatResetRemaining,
} from "../shared/resetTime.ts";
import type {
  CodexRateLimitResetCredits,
  CodexRateLimitWindow,
  MenuBarDisplay,
  UsageCurrency,
  UsagePreferences,
  UsagePreferencesPatch,
  UsageSnapshot,
} from "../shared/types.ts";
import { MENU_BAR_DISPLAYS, USAGE_RANGES } from "../shared/types.ts";
import {
  formatCount,
  formatCurrency,
  formatMode,
  formatTokens,
  formatUpdatedAt,
  rangeLabel,
} from "./format.ts";
import { api } from "./api.ts";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unknown operation failure";
}

function planLabel(snapshot: UsageSnapshot): string {
  const { planType, status } = snapshot.rateLimits;
  if (status === "stale") return "Last known";
  if (planType === null) return "Codex plan";
  return `${planType.replaceAll("_", " ")} plan`;
}

function MenuToggle({
  label,
  detail,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly detail: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className={`menu-toggle-row${disabled ? " disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <button
        type="button"
        className="menu-switch"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}

function LimitRow({
  label,
  limit,
  nowMs,
}: {
  readonly label: string;
  readonly limit: CodexRateLimitWindow | null;
  readonly nowMs: number;
}) {
  const remainingPercent = Math.min(100, Math.max(0, limit?.remainingPercent ?? 0));
  return (
    <div className={`menu-limit-row${limit === null ? " unavailable" : ""}`}>
      <div className="menu-limit-topline">
        <span>{label}</span>
        <strong>{limit === null ? "—" : `${limit.remainingPercent}% left`}</strong>
      </div>
      <progress
        className="menu-limit-track"
        aria-label={`${label} remaining`}
        max={100}
        value={remainingPercent}
      />
      <div className="menu-limit-schedule">
        <span>
          {limit === null ? "Time unavailable" : formatResetRemaining(limit.resetsAt, nowMs)}
        </span>
        <time dateTime={limit?.resetsAt ?? undefined}>
          {limit === null ? "Reset unavailable" : formatResetDateTime(limit.resetsAt)}
        </time>
      </div>
    </div>
  );
}

function ResetCreditRow({
  resetCredits,
  nowMs,
}: {
  readonly resetCredits: CodexRateLimitResetCredits;
  readonly nowMs: number;
}) {
  const countLabel =
    resetCredits.availableCount === 1
      ? "1 reset available"
      : `${resetCredits.availableCount} resets available`;
  return (
    <div className="menu-reset-credit" aria-label="Banked Codex usage reset">
      <div>
        <span>Banked reset</span>
        <strong>{countLabel}</strong>
      </div>
      <div>
        <strong>{formatExpiryRemaining(resetCredits.expiresAt, nowMs)}</strong>
        <time dateTime={resetCredits.expiresAt ?? undefined}>
          {formatExpiryDateTime(resetCredits.expiresAt)}
        </time>
      </div>
    </div>
  );
}

function MenuHeader({
  updatedAt,
  refreshing,
  onRefresh,
}: {
  readonly updatedAt: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <header className="menu-bar-header">
      <img src={appIconUrl} alt="" />
      <div>
        <h1>Codex Usage</h1>
        <p>{updatedAt === null ? "Reading local usage…" : formatUpdatedAt(updatedAt)}</p>
      </div>
      <button
        type="button"
        className="menu-icon-button"
        aria-label={refreshing ? "Refreshing usage" : "Refresh usage"}
        disabled={refreshing}
        onClick={onRefresh}
      >
        <RefreshCwIcon size={15} />
      </button>
    </header>
  );
}

function MenuFooter({ onError }: { readonly onError: (message: string) => void }) {
  const run = (action: Promise<void>) => {
    void action.catch((cause: unknown) => onError(errorMessage(cause)));
  };
  return (
    <footer className="menu-bar-footer">
      <button type="button" className="menu-open-button" onClick={() => run(api.openMainWindow())}>
        Open dashboard
        <ArrowUpRightIcon size={14} />
      </button>
      <button
        type="button"
        className="menu-footer-button"
        aria-label="About Codex Usage"
        onClick={() => run(api.openAboutWindow())}
      >
        <InfoIcon size={15} />
      </button>
      <button
        type="button"
        className="menu-footer-button danger"
        aria-label="Quit Codex Usage"
        onClick={() => run(api.quitApp())}
      >
        <PowerIcon size={15} />
      </button>
    </footer>
  );
}

export function MenuBarView() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [preferences, setPreferences] = useState<UsagePreferences | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const unsubscribeSnapshot = api.onSnapshot((value) => {
      if (!active) return;
      setSnapshot(value);
      setError(null);
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
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.closeMenuBarPopover();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const refresh = () => {
    setRefreshing(true);
    setError(null);
    void api
      .refresh()
      .then((value) => setSnapshot(value))
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setRefreshing(false));
  };

  const updatePreferences = (patch: UsagePreferencesPatch) => {
    setError(null);
    void api
      .updatePreferences(patch)
      .then((value) => setPreferences(value))
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  if (snapshot === null || preferences === null) {
    return (
      <main className="menu-bar-shell">
        <div className="menu-bar-surface">
          <MenuHeader updatedAt={null} refreshing={refreshing} onRefresh={refresh} />
          <section className="menu-bar-empty" aria-live="polite">
            <span />
            <h2>{error === null ? "Reading your usage" : "Usage could not be read"}</h2>
            <p>{error ?? "Scanning local Codex sessions and account limits…"}</p>
            {error === null ? null : (
              <button type="button" onClick={refresh}>
                Try again
              </button>
            )}
          </section>
          <MenuFooter onError={setError} />
        </div>
      </main>
    );
  }

  const summary = snapshot.ranges[preferences.menuBarRange];
  const rangeEnabled = menuBarDisplayUsesRange(preferences.menuBarDisplay);
  const topModel = summary.models[0]?.key ?? "No activity";
  const topMode = summary.modes[0]?.mode ?? undefined;

  return (
    <main className="menu-bar-shell">
      <div className="menu-bar-surface">
        <MenuHeader updatedAt={snapshot.readAt} refreshing={refreshing} onRefresh={refresh} />

        {error === null ? null : (
          <button
            type="button"
            className="menu-bar-error"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            {error}
          </button>
        )}

        <section className="menu-weekly-section" aria-labelledby="menu-limits-heading">
          <div className="menu-section-heading">
            <h2 id="menu-limits-heading">Usage limits</h2>
            <span>{planLabel(snapshot)}</span>
          </div>
          <LimitRow label="Codex weekly" limit={snapshot.rateLimits.codex} nowMs={nowMs} />
          {snapshot.rateLimits.codexFiveHour === null ? null : (
            <LimitRow
              label="Codex 5-hour"
              limit={snapshot.rateLimits.codexFiveHour}
              nowMs={nowMs}
            />
          )}
          <LimitRow label="Spark weekly" limit={snapshot.rateLimits.spark} nowMs={nowMs} />
          {snapshot.rateLimits.sparkFiveHour === null ? null : (
            <LimitRow
              label="Spark 5-hour"
              limit={snapshot.rateLimits.sparkFiveHour}
              nowMs={nowMs}
            />
          )}
          {snapshot.rateLimits.resetCredits === null ? null : (
            <ResetCreditRow resetCredits={snapshot.rateLimits.resetCredits} nowMs={nowMs} />
          )}
        </section>

        <section className="menu-activity-section" aria-labelledby="menu-activity-heading">
          <div className="menu-section-heading">
            <h2 id="menu-activity-heading">{rangeLabel(preferences.menuBarRange)} activity</h2>
            <span>{formatCount(summary.records)} responses</span>
          </div>
          <div className="menu-activity-metrics">
            <div>
              <span>Cost</span>
              <strong>
                {formatCurrency(summary.costUsd, preferences.currency, snapshot.exchangeRates)}
              </strong>
            </div>
            <div>
              <span>Tokens</span>
              <strong>{formatTokens(summary.totalTokens)}</strong>
            </div>
            <div>
              <span>Sessions</span>
              <strong>{formatCount(summary.sessions)}</strong>
            </div>
          </div>
          <div className="menu-activity-context">
            <span>
              Top model <strong>{topModel}</strong>
            </span>
            <span>
              Mode <strong>{topMode === undefined ? "No activity" : formatMode(topMode)}</strong>
            </span>
          </div>
        </section>

        <section className="menu-preferences-section" aria-labelledby="menu-preferences-heading">
          <div className="menu-section-heading menu-preferences-heading">
            <h2 id="menu-preferences-heading">
              <Settings2Icon size={13} /> Status item
            </h2>
            <span>Choose what appears above</span>
          </div>
          <label className="menu-display-field">
            <span>Currency</span>
            <select
              value={preferences.currency}
              onChange={(event) =>
                updatePreferences({ currency: event.target.value as UsageCurrency })
              }
            >
              {USAGE_CURRENCY_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.currencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {USAGE_CURRENCY_LABELS[currency]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <p className="menu-currency-note">
            {usageCurrencyRateNote(preferences.currency, snapshot.exchangeRates)}
          </p>
          <label className="menu-display-field">
            <span>Displayed value</span>
            <select
              value={preferences.menuBarDisplay}
              onChange={(event) =>
                updatePreferences({ menuBarDisplay: event.target.value as MenuBarDisplay })
              }
            >
              {MENU_BAR_DISPLAYS.map((display) => (
                <option key={display} value={display}>
                  {MENU_BAR_DISPLAY_LABELS[display]}
                </option>
              ))}
            </select>
          </label>
          <div className={`menu-range-field${rangeEnabled ? "" : " disabled"}`}>
            <span>Range</span>
            <fieldset disabled={!rangeEnabled}>
              <legend className="sr-only">Menu bar range</legend>
              {USAGE_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={preferences.menuBarRange === range}
                  onClick={() => updatePreferences({ menuBarRange: range })}
                >
                  {rangeLabel(range)}
                </button>
              ))}
            </fieldset>
          </div>
          <div className="menu-toggle-list">
            <MenuToggle
              label="Menu bar icon"
              detail="Show the Codex Usage mark"
              checked={preferences.showMenuBarIcon || preferences.menuBarDisplay === "icon-only"}
              disabled={preferences.menuBarDisplay === "icon-only"}
              onChange={(showMenuBarIcon) => updatePreferences({ showMenuBarIcon })}
            />
            <MenuToggle
              label="Launch at login"
              detail="Keep usage close at hand"
              checked={preferences.launchAtLogin}
              onChange={(launchAtLogin) => updatePreferences({ launchAtLogin })}
            />
            <MenuToggle
              label="Show in menu bar"
              detail="Turn off the status item"
              checked={preferences.showInMenuBar}
              onChange={(showInMenuBar) => updatePreferences({ showInMenuBar })}
            />
          </div>
        </section>

        <MenuFooter onError={setError} />
      </div>
    </main>
  );
}
