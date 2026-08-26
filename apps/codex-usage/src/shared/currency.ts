import type { UsageCurrency } from "./types.ts";

export const AED_PER_USD = 3.6725;

export const USAGE_CURRENCY_LABELS: Readonly<Record<UsageCurrency, string>> = {
  USD: "USD ($)",
  AED: "AED (د.إ)",
};

export function convertUsd(value: number, currency: UsageCurrency): number {
  return currency === "AED" ? value * AED_PER_USD : value;
}
