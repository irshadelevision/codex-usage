import * as NodeFSP from "node:fs/promises";

import type { PricingStatus, TokenTotals } from "../shared/types.ts";

const RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

export interface ModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
  readonly fastMultiplier?: number;
  readonly cacheCreationOneHourCostPerToken?: number;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

interface RateCache {
  readonly fetchedAtMs: number;
  readonly document: unknown;
}

interface RateLoadResult {
  readonly rates: RateTable;
  readonly status: PricingStatus;
  readonly fetchedAtMs: number | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const input = finiteNumber(entry["input_cost_per_token"]);
    const output = finiteNumber(entry["output_cost_per_token"]);
    if (input === null || output === null) continue;

    const key = normalizeModelName(name);
    if (!key) continue;
    const specific = entry["provider_specific_entry"];
    const fast =
      typeof specific === "object" && specific !== null
        ? finiteNumber((specific as Record<string, unknown>)["fast"])
        : null;
    table.set(key, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      cacheReadCostPerToken: finiteNumber(entry["cache_read_input_token_cost"]) ?? input,
      cacheCreationCostPerToken: finiteNumber(entry["cache_creation_input_token_cost"]) ?? input,
      cacheCreationOneHourCostPerToken:
        finiteNumber(entry["cache_creation_input_token_cost_above_1hr"]) ??
        finiteNumber(entry["cache_creation_input_token_cost"]) ??
        input,
      fastMultiplier: fast !== null && fast > 0 ? fast : 1,
    });
  }
  // Provider-qualified prices must never overwrite the canonical direct model rate.
  const aliases = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const bare = key.slice(key.lastIndexOf("/") + 1);
    if (bare === key || table.has(bare)) continue;
    const held = aliases.get(bare);
    if (held === undefined) aliases.set(bare, rate);
    else if (held !== null && JSON.stringify(held) !== JSON.stringify(rate))
      aliases.set(bare, null);
  }
  for (const [key, rate] of aliases) if (rate !== null) table.set(key, rate);
  return table;
}

function decodeCache(value: unknown): RateCache | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["fetchedAtMs"] !== "number" || !("document" in record)) return null;
  return { fetchedAtMs: record["fetchedAtMs"], document: record["document"] };
}

async function readCache(cachePath: string): Promise<RateCache | null> {
  try {
    return decodeCache(JSON.parse(await NodeFSP.readFile(cachePath, "utf8")));
  } catch {
    return null;
  }
}

export async function loadRates(cachePath: string, nowMs: number): Promise<RateLoadResult> {
  const cached = await readCache(cachePath);
  const cachedRates =
    cached === null ? new Map<string, ModelRate>() : parseRateTable(cached.document);
  if (cached !== null && cachedRates.size > 0 && nowMs - cached.fetchedAtMs < RATES_TTL_MS) {
    return { rates: cachedRates, status: "cached", fetchedAtMs: cached.fetchedAtMs };
  }

  try {
    const response = await fetch(RATES_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Pricing request failed with ${response.status}`);
    const document: unknown = await response.json();
    const rates = parseRateTable(document);
    if (rates.size === 0) throw new Error("Pricing response contained no usable models");
    await NodeFSP.writeFile(
      cachePath,
      JSON.stringify({ fetchedAtMs: nowMs, document }),
      "utf8",
    ).catch(() => undefined);
    return { rates, status: "fresh", fetchedAtMs: nowMs };
  } catch {
    if (cached !== null && cachedRates.size > 0) {
      return { rates: cachedRates, status: "cached", fetchedAtMs: cached.fetchedAtMs };
    }
    return { rates: new Map(), status: "unavailable", fetchedAtMs: null };
  }
}

const UNPRICEABLE_MODELS = new Set([
  "",
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

export function priceTokens(
  rates: RateTable,
  model: string,
  totals: TokenTotals,
  options: { readonly fast?: boolean; readonly reportedCostUsd?: number | null } = {},
): { readonly costUsd: number; readonly cacheSavingsUsd: number; readonly priced: boolean } {
  const normalized = normalizeModelName(model).split("[")[0]!;
  if (UNPRICEABLE_MODELS.has(normalized.slice(normalized.lastIndexOf("/") + 1))) {
    return { costUsd: 0, cacheSavingsUsd: 0, priced: false };
  }
  const rate = rates.get(normalized);
  const reported = finiteNumber(options.reportedCostUsd);
  if (reported !== null) return { costUsd: reported, cacheSavingsUsd: 0, priced: true };
  if (rate === undefined) return { costUsd: 0, cacheSavingsUsd: 0, priced: false };
  const multiplier = options.fast ? (rate.fastMultiplier ?? 1) : 1;
  const oneHour = Math.min(totals.cacheCreationTokens, totals.cacheCreationOneHourTokens ?? 0);

  return {
    costUsd:
      (totals.uncachedInputTokens * rate.inputCostPerToken +
        totals.cachedInputTokens * rate.cacheReadCostPerToken +
        (totals.cacheCreationTokens - oneHour) * rate.cacheCreationCostPerToken +
        oneHour * (rate.cacheCreationOneHourCostPerToken ?? rate.cacheCreationCostPerToken) +
        totals.outputTokens * rate.outputCostPerToken) *
      multiplier,
    cacheSavingsUsd: Math.max(
      0,
      totals.cachedInputTokens * (rate.inputCostPerToken - rate.cacheReadCostPerToken) * multiplier,
    ),
    priced: true,
  };
}
