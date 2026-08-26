import type {
  CodexUsageApi,
  RangeSummary,
  TokenTotals,
  UsageBreakdownRow,
  UsagePreferences,
  UsagePreferencesPatch,
  UsageRange,
  UsageSnapshot,
} from "../shared/types.ts";
import { LIVE_USAGE_CURRENCIES } from "../shared/types.ts";

const rangeSize: Record<UsageRange, number> = { "24h": 24, "7d": 7, "30d": 30, "90d": 90 };
const rangeScale: Record<UsageRange, number> = { "24h": 0.48, "7d": 1, "30d": 3.1, "90d": 8.2 };

function breakdownRow(
  key: string,
  costUsd: number,
  costTotal: number,
  tokens: number,
  tokenTotal: number,
  sessions: number,
  model: string,
  mode: string | null,
): UsageBreakdownRow {
  return {
    key,
    model,
    mode,
    costUsd,
    costShare: costUsd / costTotal,
    totalTokens: tokens,
    tokenShare: tokens / tokenTotal,
    sessions,
  };
}

function sampleSummary(range: UsageRange, nowMs: number): RangeSummary {
  const count = rangeSize[range];
  const scale = rangeScale[range];
  const step = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const end = Math.floor(nowMs / step) * step;
  const start = end - (count - 1) * step;
  const series = Array.from({ length: count }, (_, index) => {
    const wave = 0.45 + Math.sin(index * 0.68) * 0.19 + Math.sin(index * 0.21) * 0.24;
    const lift = index / Math.max(1, count - 1);
    return {
      key:
        range === "24h"
          ? new Date(start + index * step).toISOString()
          : new Date(start + index * step).toISOString().slice(0, 10),
      costUsd: Math.max(0.05, (wave + lift * 0.22) * scale),
      totalTokens: Math.round(Math.max(18_000, (wave + lift * 0.22) * 1_460_000 * scale)),
    };
  });
  const costUsd = series.reduce((sum, point) => sum + point.costUsd, 0);
  const totalTokens = series.reduce((sum, point) => sum + point.totalTokens, 0);
  const totals: TokenTotals = {
    cachedInputTokens: Math.round(totalTokens * 0.396),
    uncachedInputTokens: Math.round(totalTokens * 0.364),
    cacheCreationTokens: Math.round(totalTokens * 0.071),
    outputTokens: Math.round(totalTokens * 0.169),
    reasoningTokens: Math.round(totalTokens * 0.071),
  };
  const modelCosts = [0.514, 0.257, 0.154, 0.049, 0.026];
  const modelTokens = [0.51, 0.259, 0.153, 0.05, 0.028];
  const modelNames = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "codex-auto-review"];
  const modeCosts = [0.099, 0.335, 0.398, 0.168];
  const modeNames = ["low", "medium", "high", "xhigh"];
  const modeModels = ["gpt-5.5", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-sol"];
  const sessions = Math.max(4, Math.round(32 * scale));

  return {
    range,
    since:
      range === "24h" ? new Date(start).toISOString() : new Date(start).toISOString().slice(0, 10),
    until:
      range === "24h"
        ? new Date(end + step).toISOString()
        : new Date(end).toISOString().slice(0, 10),
    costUsd,
    totals,
    totalTokens,
    cacheSavingsUsd: costUsd * 0.254,
    records: Math.round(190 * scale),
    sessions,
    unpricedRecords: 0,
    series,
    models: modelNames.map((name, index) =>
      breakdownRow(
        name,
        costUsd * (modelCosts[index] ?? 0),
        costUsd,
        totalTokens * (modelTokens[index] ?? 0),
        totalTokens,
        Math.max(1, sessions - index * 4),
        name,
        null,
      ),
    ),
    modes: modeNames.map((name, index) =>
      breakdownRow(
        JSON.stringify([modeModels[index] ?? "unknown", name]),
        costUsd * (modeCosts[index] ?? 0),
        costUsd,
        totalTokens * (modeCosts[index] ?? 0),
        totalTokens,
        Math.max(1, Math.round(sessions * (modeCosts[index] ?? 0))),
        modeModels[index] ?? "unknown",
        name,
      ),
    ),
  };
}

function makeSnapshot(): UsageSnapshot {
  const nowMs = Date.now();
  const sampleRateDate = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    readAt: new Date(nowMs).toISOString(),
    sourcePath: "~/.codex/sessions",
    scannedFiles: 143,
    skippedFiles: 18,
    scanDurationMs: 184,
    pricing: {
      status: "cached",
      knownModels: 412,
      fetchedAt: new Date(nowMs - 3_600_000).toISOString(),
    },
    exchangeRates: {
      status: "fresh",
      source: "Frankfurter",
      fetchedAt: new Date(nowMs - 3_600_000).toISOString(),
      rates: Object.fromEntries(
        LIVE_USAGE_CURRENCIES.map((currency, index) => [currency, (index + 11) / 10]),
      ),
      rateDates: Object.fromEntries(
        LIVE_USAGE_CURRENCIES.map((currency) => [currency, sampleRateDate]),
      ),
      message: null,
    },
    rateLimits: {
      status: "available",
      readAt: new Date(nowMs).toISOString(),
      planType: "pro",
      message: null,
      codex: {
        limitId: "codex",
        name: "Codex plan",
        usedPercent: 42,
        remainingPercent: 58,
        resetsAt: new Date(nowMs + 3.2 * 24 * 60 * 60 * 1000).toISOString(),
        windowDurationMins: 10_080,
      },
      spark: {
        limitId: "codex_bengalfox",
        name: "GPT-5.3-Codex-Spark",
        usedPercent: 18,
        remainingPercent: 82,
        resetsAt: new Date(nowMs + 5.4 * 24 * 60 * 60 * 1000).toISOString(),
        windowDurationMins: 10_080,
      },
    },
    ranges: {
      "24h": sampleSummary("24h", nowMs),
      "7d": sampleSummary("7d", nowMs),
      "30d": sampleSummary("30d", nowMs),
      "90d": sampleSummary("90d", nowMs),
    },
  };
}

export function createSampleApi(): CodexUsageApi {
  let snapshot = makeSnapshot();
  let preferences: UsagePreferences = {
    showInMenuBar: true,
    showMenuBarIcon: true,
    launchAtLogin: false,
    currency: "USD",
    menuBarRange: "7d",
    menuBarDisplay: "cost",
  };
  const snapshotListeners = new Set<(value: UsageSnapshot) => void>();
  const preferenceListeners = new Set<(value: UsagePreferences) => void>();
  return {
    getSnapshot: () => Promise.resolve(snapshot),
    refresh: () => {
      snapshot = makeSnapshot();
      for (const listener of snapshotListeners) listener(snapshot);
      return Promise.resolve(snapshot);
    },
    getPreferences: () => Promise.resolve(preferences),
    updatePreferences: (patch: UsagePreferencesPatch) => {
      preferences = { ...preferences, ...patch };
      for (const listener of preferenceListeners) listener(preferences);
      return Promise.resolve(preferences);
    },
    getAppInfo: () =>
      Promise.resolve({ name: "Codex Usage", version: "0.1.21", author: "Irshad Ibrahim" }),
    checkForUpdates: () =>
      Promise.resolve({
        currentVersion: "0.1.21",
        latestVersion: "0.1.21",
        updateAvailable: false,
        releaseUrl: "https://github.com/irshadelevision/codex-usage/releases/tag/v0.1.21",
        downloadUrl:
          "https://github.com/irshadelevision/codex-usage/releases/download/v0.1.21/Codex.Usage-0.1.21-arm64.dmg",
      }),
    openMainWindow: () => Promise.resolve(),
    openAboutWindow: () => Promise.resolve(),
    openRelease: () => Promise.resolve(),
    downloadUpdate: () => Promise.resolve(),
    closeMenuBarPopover: () => Promise.resolve(),
    quitApp: () => Promise.resolve(),
    onSnapshot: (listener) => {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    onPreferences: (listener) => {
      preferenceListeners.add(listener);
      return () => preferenceListeners.delete(listener);
    },
  };
}
