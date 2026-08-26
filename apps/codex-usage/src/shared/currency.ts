import type { UsageCurrency } from "./types.ts";

export const CURRENCY_PER_USD: Readonly<Record<UsageCurrency, number>> = {
  USD: 1,
  AED: 3.6725,
  SAR: 3.75,
  BHD: 0.376,
  QAR: 3.64,
  OMR: 0.385,
  JOD: 0.71,
  HKD: 7.8,
};

export const CURRENCY_FRACTION_DIGITS: Readonly<Record<UsageCurrency, number>> = {
  USD: 2,
  AED: 2,
  SAR: 2,
  BHD: 3,
  QAR: 2,
  OMR: 3,
  JOD: 3,
  HKD: 2,
};

export const USAGE_CURRENCY_LABELS: Readonly<Record<UsageCurrency, string>> = {
  USD: "USD — US Dollar",
  AED: "AED — UAE Dirham",
  SAR: "SAR — Saudi Riyal",
  BHD: "BHD — Bahraini Dinar",
  QAR: "QAR — Qatari Riyal",
  OMR: "OMR — Omani Rial",
  JOD: "JOD — Jordanian Dinar",
  HKD: "HKD — Hong Kong Dollar",
};

export const USAGE_CURRENCY_RATE_NOTES: Readonly<Record<UsageCurrency, string>> = {
  USD: "Cost estimates are shown in US dollars.",
  AED: "Fixed display rate: 1 USD = 3.6725 AED.",
  SAR: "Fixed display rate: 1 USD = 3.75 SAR.",
  BHD: "Fixed display rate: 1 USD = 0.376 BHD.",
  QAR: "Fixed display rate: 1 USD = 3.64 QAR.",
  OMR: "Fixed display rate: 1 USD = 0.385 OMR.",
  JOD: "Fixed display rate: 1 USD = 0.71 JOD.",
  HKD: "Display rate: 1 USD = 7.80 HKD, the midpoint of the 7.75–7.85 band.",
};

export function convertUsd(value: number, currency: UsageCurrency): number {
  return value * CURRENCY_PER_USD[currency];
}
