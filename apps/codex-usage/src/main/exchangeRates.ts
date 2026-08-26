import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ExchangeRateSnapshot, UsageCurrency } from "../shared/types.ts";
import { LIVE_USAGE_CURRENCIES } from "../shared/types.ts";

const CACHE_VERSION = 2;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const SOURCE = "Frankfurter" as const;
const FRANKFURTER_URL = `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${LIVE_USAGE_CURRENCIES.join(",")}`;

interface CachedExchangeRates {
  readonly version: typeof CACHE_VERSION;
  readonly fetchedAt: string;
  readonly rates: Readonly<Partial<Record<UsageCurrency, number>>>;
  readonly rateDates: Readonly<Partial<Record<UsageCurrency, string>>>;
}

type RequestRates = (url: string, init: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function decodeRates(value: unknown, fetchedAt: string): CachedExchangeRates {
  if (!Array.isArray(value)) throw new Error("Frankfurter returned an invalid response.");
  const rates: Partial<Record<UsageCurrency, number>> = {};
  const rateDates: Partial<Record<UsageCurrency, string>> = {};
  for (const item of value) {
    if (!isRecord(item) || item["base"] !== "USD") continue;
    const quote = item["quote"];
    const rate = item["rate"];
    const date = item["date"];
    if (
      typeof quote !== "string" ||
      !LIVE_USAGE_CURRENCIES.includes(quote as (typeof LIVE_USAGE_CURRENCIES)[number]) ||
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      !isDate(date)
    ) {
      continue;
    }
    const currency = quote as (typeof LIVE_USAGE_CURRENCIES)[number];
    rates[currency] = rate;
    rateDates[currency] = date;
  }
  const missing = LIVE_USAGE_CURRENCIES.filter((currency) => rates[currency] === undefined);
  if (missing.length > 0) {
    throw new Error(`Frankfurter did not return rates for: ${missing.join(", ")}.`);
  }
  return { version: CACHE_VERSION, fetchedAt, rates, rateDates };
}

function decodeCache(value: unknown): CachedExchangeRates | null {
  if (!isRecord(value) || value["version"] !== CACHE_VERSION) return null;
  const fetchedAt = value["fetchedAt"];
  const inputRates = value["rates"];
  const inputDates = value["rateDates"];
  if (
    typeof fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    !isRecord(inputRates) ||
    !isRecord(inputDates)
  ) {
    return null;
  }
  const rows = LIVE_USAGE_CURRENCIES.map((currency) => ({
    base: "USD",
    quote: currency,
    rate: inputRates[currency],
    date: inputDates[currency],
  }));
  try {
    return decodeRates(rows, fetchedAt);
  } catch {
    return null;
  }
}

function snapshot(
  status: ExchangeRateSnapshot["status"],
  cache: CachedExchangeRates | null,
  message: string | null,
): ExchangeRateSnapshot {
  return {
    status,
    source: SOURCE,
    fetchedAt: cache?.fetchedAt ?? null,
    rates: cache?.rates ?? {},
    rateDates: cache?.rateDates ?? {},
    message,
  };
}

export class ExchangeRateReader {
  readonly #cachePath: string;
  readonly #request: RequestRates;
  #cache: CachedExchangeRates | null = null;
  #cacheLoaded = false;
  #readInFlight: Promise<ExchangeRateSnapshot> | null = null;

  constructor(cachePath: string, request: RequestRates = fetch) {
    this.#cachePath = cachePath;
    this.#request = request;
  }

  async read(nowMs = Date.now(), force = false): Promise<ExchangeRateSnapshot> {
    if (this.#readInFlight !== null) return this.#readInFlight;
    this.#readInFlight = this.#read(nowMs, force).finally(() => {
      this.#readInFlight = null;
    });
    return this.#readInFlight;
  }

  async #read(nowMs: number, force: boolean): Promise<ExchangeRateSnapshot> {
    await this.#loadCache();
    const cacheAge =
      this.#cache === null ? Number.POSITIVE_INFINITY : nowMs - Date.parse(this.#cache.fetchedAt);
    if (!force && cacheAge >= 0 && cacheAge < REFRESH_INTERVAL_MS) {
      return snapshot("cached", this.#cache, null);
    }

    try {
      const response = await this.#request(FRANKFURTER_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Frankfurter returned HTTP ${response.status}.`);
      const next = decodeRates(await response.json(), new Date(nowMs).toISOString());
      this.#cache = next;
      await this.#writeCache(next).catch(() => undefined);
      return snapshot("fresh", next, null);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (this.#cache !== null) {
        return snapshot(
          "cached",
          this.#cache,
          `Using cached rates because refresh failed: ${detail}`,
        );
      }
      return snapshot("unavailable", null, `Live exchange rates are unavailable: ${detail}`);
    }
  }

  async #loadCache() {
    if (this.#cacheLoaded) return;
    this.#cacheLoaded = true;
    try {
      this.#cache = decodeCache(JSON.parse(await NodeFSP.readFile(this.#cachePath, "utf8")));
    } catch {
      this.#cache = null;
    }
  }

  async #writeCache(value: CachedExchangeRates) {
    const temporaryPath = `${this.#cachePath}.tmp`;
    await NodeFSP.mkdir(NodePath.dirname(this.#cachePath), { recursive: true });
    try {
      await NodeFSP.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
      await NodeFSP.rename(temporaryPath, this.#cachePath);
    } finally {
      await NodeFSP.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
