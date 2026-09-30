import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { loadRates, parseRateTable, priceTokens } from "./pricing.ts";

describe("usage pricing", () => {
  const tokens = {
    uncachedInputTokens: 100,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 10,
    reasoningTokens: 5,
  };

  it("preserves canonical prices regardless of provider entry order", () => {
    const direct = { input_cost_per_token: 2e-6, output_cost_per_token: 10e-6 };
    const reseller = { input_cost_per_token: 9e-6, output_cost_per_token: 30e-6 };
    for (const entries of [
      [
        ["gpt-example", direct],
        ["azure/gpt-example", reseller],
      ],
      [
        ["azure/gpt-example", reseller],
        ["gpt-example", direct],
      ],
    ] as const) {
      const table = parseRateTable(Object.fromEntries(entries));
      expect(priceTokens(table, "gpt-example", tokens).costUsd).toBeCloseTo(0.0003);
      expect(priceTokens(table, "azure/gpt-example", tokens).costUsd).toBeCloseTo(0.0012);
      expect(priceTokens(table, "unknown/gpt-example", tokens).priced).toBe(false);
    }
  });

  it("does not guess ambiguous provider aliases", () => {
    const table = parseRateTable({
      "first/model": { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
      "second/model": { input_cost_per_token: 2e-6, output_cost_per_token: 2e-6 },
    });
    expect(priceTokens(table, "model", tokens).priced).toBe(false);
    expect(priceTokens(table, "first/model", tokens).priced).toBe(true);
  });

  it("accounts for Claude cache lifetimes and fast mode without double counting", () => {
    const table = parseRateTable({
      "claude-example": {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 15e-6,
        cache_read_input_token_cost: 0.3e-6,
        cache_creation_input_token_cost: 3.75e-6,
        cache_creation_input_token_cost_above_1hr: 6e-6,
        provider_specific_entry: { fast: 6 },
      },
    });
    const result = priceTokens(
      table,
      "Claude-Example[1m]",
      {
        ...tokens,
        cachedInputTokens: 200,
        cacheCreationTokens: 100,
        cacheCreationOneHourTokens: 40,
      },
      { fast: true },
    );
    expect(result.costUsd).toBeCloseTo(
      (100 * 3 + 200 * 0.3 + 60 * 3.75 + 40 * 6 + 10 * 15) * 6e-6,
      10,
    );
    expect(result.cacheSavingsUsd).toBeCloseTo(200 * 2.7 * 6e-6, 10);
  });

  it("prefers recorded cost but rejects invalid costs and synthetic models", () => {
    expect(
      priceTokens(new Map(), "claude-example", tokens, { reportedCostUsd: 0.12 }).costUsd,
    ).toBe(0.12);
    expect(priceTokens(new Map(), "claude-example", tokens, { reportedCostUsd: 0 }).priced).toBe(
      true,
    );
    for (const cost of [-1, Infinity, NaN]) {
      expect(
        priceTokens(new Map(), "claude-example", tokens, { reportedCostUsd: cost }).priced,
      ).toBe(false);
    }
    for (const model of ["<synthetic>", "synthetic"]) {
      expect(priceTokens(new Map(), model, tokens, { reportedCostUsd: 1 }).priced).toBe(false);
    }
    for (const model of ["opus", "anthropic/sonnet", "future-model"]) {
      expect(priceTokens(new Map(), model, tokens).priced).toBe(false);
      expect(priceTokens(new Map(), model, tokens, { reportedCostUsd: 1 })).toEqual({
        costUsd: 1,
        cacheSavingsUsd: 0,
        priced: true,
      });
    }
  });

  it("preserves estimated cache savings without multiplying a reported fast-mode cost", () => {
    const table = parseRateTable({
      "claude-example": {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 15e-6,
        cache_read_input_token_cost: 0.3e-6,
        provider_specific_entry: { fast: 6 },
      },
    });
    const result = priceTokens(
      table,
      "claude-example",
      { ...tokens, cachedInputTokens: 200 },
      {
        fast: true,
        reportedCostUsd: 0.12,
      },
    );
    expect(result.costUsd).toBe(0.12);
    expect(result.cacheSavingsUsd).toBeCloseTo(200 * 2.7 * 6e-6, 10);
    expect(result.priced).toBe(true);
  });

  it("normalizes provider-prefixed models and prices every token class", () => {
    const rates = parseRateTable({
      "openai/gpt-5.6-sol": {
        input_cost_per_token: 1e-6,
        output_cost_per_token: 8e-6,
        cache_read_input_token_cost: 1e-7,
        cache_creation_input_token_cost: 1.2e-6,
      },
    });
    const result = priceTokens(rates, "GPT-5.6-SOL", {
      uncachedInputTokens: 100,
      cachedInputTokens: 500,
      cacheCreationTokens: 50,
      outputTokens: 25,
      reasoningTokens: 10,
    });

    expect(result.priced).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.00041, 10);
    expect(result.cacheSavingsUsd).toBeCloseTo(0.00045, 10);
  });

  it("keeps tokens visible when a model has no published price", () => {
    const result = priceTokens(new Map(), "future-model", {
      uncachedInputTokens: 100,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 25,
      reasoningTokens: 10,
    });
    expect(result).toEqual({ costUsd: 0, cacheSavingsUsd: 0, priced: false });
  });

  it("rejects negative pricing data", () => {
    const rates = parseRateTable({
      "openai/invalid": {
        input_cost_per_token: -1,
        output_cost_per_token: 1e-6,
      },
    });

    expect(rates.size).toBe(0);
  });
});

describe("pricing refresh", () => {
  let directory: string;
  const now = Date.parse("2026-09-30T12:00:00Z");
  const document = { example: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } };
  beforeEach(async () => {
    directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-prices-"));
  });
  afterEach(async () => {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  });
  const cache = () => NodePath.join(directory, "rates.json");
  const writeCache = (ageMs: number) =>
    NodeFSP.writeFile(
      cache(),
      JSON.stringify({
        fetchedAtMs: now - ageMs,
        document,
      }),
    );

  it("keeps the daily cache for automatic scans but updates it on manual refresh", async () => {
    await writeCache(2 * 60_000);
    const fetchRates = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        example: { input_cost_per_token: 3e-6, output_cost_per_token: 4e-6 },
      }),
    );
    expect((await loadRates(cache(), now, { fetchRates })).status).toBe("cached");
    expect(fetchRates).not.toHaveBeenCalled();
    const result = await loadRates(cache(), now, { force: true, fetchRates });
    expect(result.status).toBe("fresh");
    expect(result.rates.get("example")?.inputCostPerToken).toBe(3e-6);
    expect(fetchRates).toHaveBeenCalledOnce();
    const reloaded = await loadRates(cache(), now + 30_000, { force: true, fetchRates });
    expect(reloaded.status).toBe("cached");
    expect(reloaded.rates.get("example")?.inputCostPerToken).toBe(3e-6);
    expect(fetchRates).toHaveBeenCalledOnce();
  });

  it("falls back to last-known prices when a forced request fails", async () => {
    await writeCache(2 * 60_000);
    const fetchRates = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const result = await loadRates(cache(), now, { force: true, fetchRates });
    expect(result).toMatchObject({ status: "cached", fetchedAtMs: now - 2 * 60_000 });
    expect(result.rates.get("example")?.inputCostPerToken).toBe(1e-6);
    expect(fetchRates).toHaveBeenCalledOnce();
  });

  it("refreshes an expired cache and ignores unusable cache timestamps", async () => {
    const fetchRates = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(document));
    await writeCache(24 * 60 * 60_000);
    expect((await loadRates(cache(), now, { fetchRates })).status).toBe("fresh");
    await NodeFSP.writeFile(cache(), JSON.stringify({ fetchedAtMs: "invalid", document }));
    expect((await loadRates(cache(), now, { fetchRates })).status).toBe("fresh");
    expect(fetchRates).toHaveBeenCalledTimes(2);
  });
});
