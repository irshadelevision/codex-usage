export const USAGE_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const LIVE_USAGE_CURRENCIES = [
  "ARS",
  "AUD",
  "BDT",
  "BRL",
  "CAD",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CZK",
  "DKK",
  "EGP",
  "EUR",
  "GBP",
  "GHS",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "JPY",
  "KES",
  "KRW",
  "KWD",
  "LKR",
  "MAD",
  "MXN",
  "MYR",
  "NGN",
  "NOK",
  "NPR",
  "NZD",
  "PEN",
  "PHP",
  "PKR",
  "PLN",
  "RON",
  "RUB",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "TWD",
  "UAH",
  "VND",
  "ZAR",
] as const;
export const USAGE_CURRENCIES = [
  "USD",
  "AED",
  "SAR",
  "BHD",
  "QAR",
  "OMR",
  "JOD",
  "HKD",
  ...LIVE_USAGE_CURRENCIES,
] as const;
export type UsageCurrency = (typeof USAGE_CURRENCIES)[number];

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
  readonly model: string;
  readonly mode: string | null;
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

export interface CodexRateLimitWindow {
  readonly limitId: string;
  readonly name: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly resetsAt: string | null;
  readonly windowDurationMins: number | null;
}

export interface CodexRateLimitResetCredits {
  readonly availableCount: number;
  readonly title: string | null;
  readonly expiresAt: string | null;
}

export interface CodexRateLimits {
  readonly status: CodexRateLimitStatus;
  readonly readAt: string;
  readonly planType: string | null;
  readonly codex: CodexRateLimitWindow | null;
  readonly spark: CodexRateLimitWindow | null;
  readonly codexFiveHour: CodexRateLimitWindow | null;
  readonly sparkFiveHour: CodexRateLimitWindow | null;
  readonly resetCredits: CodexRateLimitResetCredits | null;
  readonly message: string | null;
}

export type ExchangeRateStatus = "fresh" | "cached" | "unavailable";

export interface ExchangeRateSnapshot {
  readonly status: ExchangeRateStatus;
  readonly source: "Frankfurter";
  readonly fetchedAt: string | null;
  readonly rates: Readonly<Partial<Record<UsageCurrency, number>>>;
  readonly rateDates: Readonly<Partial<Record<UsageCurrency, string>>>;
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
  readonly exchangeRates: ExchangeRateSnapshot;
  readonly rateLimits: CodexRateLimits;
  readonly ranges: Readonly<Record<UsageRange, RangeSummary>>;
}

export interface UsagePreferences {
  readonly showInMenuBar: boolean;
  readonly showMenuBarIcon: boolean;
  readonly launchAtLogin: boolean;
  readonly currency: UsageCurrency;
  readonly menuBarRange: UsageRange;
  readonly menuBarDisplay: MenuBarDisplay;
}

export type UsagePreferencesPatch = Partial<UsagePreferences>;

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly author: string;
}

export interface UpdateCheckResult {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly releaseUrl: string;
  readonly downloadUrl: string | null;
}

export interface CodexUsageApi {
  readonly getSnapshot: () => Promise<UsageSnapshot>;
  readonly refresh: () => Promise<UsageSnapshot>;
  readonly getPreferences: () => Promise<UsagePreferences>;
  readonly updatePreferences: (patch: UsagePreferencesPatch) => Promise<UsagePreferences>;
  readonly getAppInfo: () => Promise<AppInfo>;
  readonly checkForUpdates: () => Promise<UpdateCheckResult>;
  readonly openMainWindow: () => Promise<void>;
  readonly openAboutWindow: () => Promise<void>;
  readonly openRelease: (url: string) => Promise<void>;
  readonly downloadUpdate: (url: string) => Promise<void>;
  readonly closeMenuBarPopover: () => Promise<void>;
  readonly quitApp: () => Promise<void>;
  readonly onSnapshot: (listener: (snapshot: UsageSnapshot) => void) => () => void;
  readonly onPreferences: (listener: (preferences: UsagePreferences) => void) => () => void;
}

declare global {
  interface Window {
    readonly codexUsage?: CodexUsageApi;
  }
}
