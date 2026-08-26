import { describe, expect, it } from "vite-plus/test";

import type { ExchangeRateSnapshot, UsageCurrency } from "./types.ts";
import { convertUsd, USAGE_CURRENCY_GROUPS, usageCurrencyRateNote } from "./currency.ts";
import { USAGE_CURRENCIES } from "./types.ts";

const exchangeRates: ExchangeRateSnapshot = {
  status: "fresh",
  source: "Frankfurter",
  fetchedAt: "2026-08-27T00:00:00.000Z",
  rates: { INR: 95.48 },
  rateDates: { INR: "2026-08-26" },
  message: null,
};

describe("convertUsd", () => {
  it.each<readonly [UsageCurrency, number]>([
    ["USD", 1],
    ["AED", 3.6725],
    ["SAR", 3.75],
    ["BHD", 0.376],
    ["QAR", 3.64],
    ["OMR", 0.385],
    ["JOD", 0.71],
    ["HKD", 7.8],
  ])("converts one USD to %s at the configured display rate", (currency, expected) => {
    expect(convertUsd(1, currency)).toBe(expected);
  });

  it("uses live snapshot rates without changing fixed peg conversions", () => {
    expect(convertUsd(2, "INR", exchangeRates)).toBe(190.96);
    expect(convertUsd(2, "AED", exchangeRates)).toBe(7.345);
    expect(convertUsd(2, "EUR")).toBeNull();
  });

  it("describes the selected live rate and its effective date", () => {
    expect(usageCurrencyRateNote("INR", exchangeRates)).toBe(
      "Daily rate for Aug 26, 2026: 1 USD = 95.48 INR. Source: Frankfurter.",
    );
  });
});

describe("currency selection", () => {
  it("places every supported currency in exactly one regional group", () => {
    const grouped = USAGE_CURRENCY_GROUPS.flatMap((group) => group.currencies);
    expect(grouped).toHaveLength(53);
    expect(grouped).toHaveLength(new Set(grouped).size);
    expect(new Set(grouped)).toEqual(new Set(USAGE_CURRENCIES));
  });
});
