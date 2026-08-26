import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { LIVE_USAGE_CURRENCIES } from "../shared/types.ts";
import { ExchangeRateReader } from "./exchangeRates.ts";

const NOW_MS = Date.parse("2026-08-27T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const RATES = Object.fromEntries(
  LIVE_USAGE_CURRENCIES.map((currency, index) => [currency, (index + 11) / 10]),
) as Readonly<Record<(typeof LIVE_USAGE_CURRENCIES)[number], number>>;

function responseRows() {
  return Object.entries(RATES).map(([quote, rate]) => ({
    date: "2026-08-26",
    base: "USD",
    quote,
    rate,
  }));
}

describe("ExchangeRateReader", () => {
  it("fetches and persists every supported live currency", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-rates-"));
    const cachePath = NodePath.join(directory, "nested", "rates.json");
    let requestUrl = "";
    try {
      const reader = new ExchangeRateReader(cachePath, async (url) => {
        requestUrl = url;
        return new Response(JSON.stringify(responseRows()), { status: 200 });
      });
      const result = await reader.read(NOW_MS);

      expect(result).toMatchObject({
        status: "fresh",
        source: "Frankfurter",
        fetchedAt: "2026-08-27T00:00:00.000Z",
        rates: RATES,
      });
      expect(requestUrl).toContain("base=USD");
      expect(new URL(requestUrl).searchParams.get("quotes")?.split(",")).toEqual([
        ...LIVE_USAGE_CURRENCIES,
      ]);
      expect(JSON.parse(await NodeFSP.readFile(cachePath, "utf8"))).toMatchObject({ rates: RATES });
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the last known cache when a daily refresh fails", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-rates-"));
    const cachePath = NodePath.join(directory, "rates.json");
    try {
      const initial = new ExchangeRateReader(
        cachePath,
        async () => new Response(JSON.stringify(responseRows()), { status: 200 }),
      );
      await initial.read(NOW_MS);

      const offline = new ExchangeRateReader(cachePath, async () => {
        throw new Error("offline");
      });
      const result = await offline.read(NOW_MS + DAY_MS + 1);
      expect(result.status).toBe("cached");
      expect(result.rates).toMatchObject(RATES);
      expect(result.message).toContain("offline");
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects incomplete provider responses instead of showing incorrect conversions", async () => {
    const reader = new ExchangeRateReader(
      "/unused/rates.json",
      async () => new Response(JSON.stringify(responseRows().slice(0, -1)), { status: 200 }),
    );
    const result = await reader.read(NOW_MS);

    expect(result.status).toBe("unavailable");
    expect(result.rates).toEqual({});
    expect(result.message).toContain("ZAR");
  });
});
