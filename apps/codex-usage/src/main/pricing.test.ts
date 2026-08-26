import { describe, expect, it } from "vite-plus/test";

import { parseRateTable, priceTokens } from "./pricing.ts";

describe("usage pricing", () => {
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
