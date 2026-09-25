import type { UsageProvider, UsageSnapshot } from "./types.ts";

export const PROVIDER_LABELS: Record<UsageProvider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  all: "Both (Codex + Claude)",
};

export function usageRanges(snapshot: UsageSnapshot, provider: UsageProvider) {
  return provider === "all" ? snapshot.ranges : snapshot.providerRanges[provider];
}
