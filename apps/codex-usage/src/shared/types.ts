export const USAGE_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export type UsageMetric = "cost" | "tokens";
export type BreakdownKind = "models" | "modes";

export const MENU_BAR_DISPLAYS = [
  "cost",
  "tokens",
  "sessions",
  "codex-weekly",
  "codex-weekly-time",
  "codex-weekly-date",
  "codex-reset",
  "spark-weekly",
  "spark-weekly-time",
  "spark-weekly-date",
  "spark-reset",
  "icon-only",
] as const;
export type MenuBarDisplay = (typeof MENU_BAR_DISPLAYS)[number];

export interface TokenTotals {
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

export interface UsagePoint {
  readonly key: string;
  readonly costUsd: number;
  readonly totalTokens: number;
}

export interface UsageBreakdownRow {
  readonly key: string;
  readonly costUsd: number;
  readonly costShare: number;
  readonly totalTokens: number;
  readonly tokenShare: number;
  readonly sessions: number;
}

export interface RangeSummary {
  readonly range: UsageRange;
  readonly since: string;
  readonly until: string;
  readonly costUsd: number;
  readonly totals: TokenTotals;
  readonly totalTokens: number;
  readonly cacheSavingsUsd: number;
  readonly records: number;
  readonly sessions: number;
  readonly unpricedRecords: number;
  readonly series: readonly UsagePoint[];
  readonly models: readonly UsageBreakdownRow[];
  readonly modes: readonly UsageBreakdownRow[];
}

export type PricingStatus = "fresh" | "cached" | "unavailable";

export type CodexRateLimitStatus = "available" | "stale" | "unavailable" | "not-installed";

export interface CodexWeeklyRateLimit {
  readonly limitId: string;
  readonly name: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly resetsAt: string | null;
  readonly windowDurationMins: number | null;
}

export interface CodexRateLimits {
  readonly status: CodexRateLimitStatus;
  readonly readAt: string;
  readonly planType: string | null;
  readonly codex: CodexWeeklyRateLimit | null;
  readonly spark: CodexWeeklyRateLimit | null;
  readonly message: string | null;
}

export interface UsageSnapshot {
  readonly readAt: string;
  readonly sourcePath: string;
  readonly scannedFiles: number;
  readonly skippedFiles: number;
  readonly scanDurationMs: number;
  readonly pricing: {
    readonly status: PricingStatus;
    readonly knownModels: number;
    readonly fetchedAt: string | null;
  };
  readonly rateLimits: CodexRateLimits;
  readonly ranges: Readonly<Record<UsageRange, RangeSummary>>;
}

export interface UsagePreferences {
  readonly showInMenuBar: boolean;
  readonly launchAtLogin: boolean;
  readonly menuBarRange: UsageRange;
  readonly menuBarDisplay: MenuBarDisplay;
}

export type UsagePreferencesPatch = Partial<UsagePreferences>;

export interface CodexUsageApi {
  readonly getSnapshot: () => Promise<UsageSnapshot>;
  readonly refresh: () => Promise<UsageSnapshot>;
  readonly getPreferences: () => Promise<UsagePreferences>;
  readonly updatePreferences: (patch: UsagePreferencesPatch) => Promise<UsagePreferences>;
  readonly onSnapshot: (listener: (snapshot: UsageSnapshot) => void) => () => void;
  readonly onPreferences: (listener: (preferences: UsagePreferences) => void) => () => void;
}

declare global {
  interface Window {
    readonly codexUsage?: CodexUsageApi;
  }
}
