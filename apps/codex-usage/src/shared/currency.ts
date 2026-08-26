import type { ExchangeRateSnapshot, UsageCurrency } from "./types.ts";

export const CURRENCY_PER_USD: Readonly<Partial<Record<UsageCurrency, number>>> = {
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
  AUD: 2,
  CNY: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  KRW: 0,
  RUB: 2,
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
  AUD: "AUD — Australian Dollar",
  CNY: "CNY — Chinese Yuan",
  EUR: "EUR — Euro",
  GBP: "GBP — British Pound",
  INR: "INR — Indian Rupee",
  KRW: "KRW — South Korean Won",
  RUB: "RUB — Russian Ruble",
};

const FIXED_CURRENCY_RATE_NOTES: Readonly<Partial<Record<UsageCurrency, string>>> = {
  USD: "Cost estimates are shown in US dollars.",
  AED: "Fixed display rate: 1 USD = 3.6725 AED.",
  SAR: "Fixed display rate: 1 USD = 3.75 SAR.",
  BHD: "Fixed display rate: 1 USD = 0.376 BHD.",
  QAR: "Fixed display rate: 1 USD = 3.64 QAR.",
  OMR: "Fixed display rate: 1 USD = 0.385 OMR.",
  JOD: "Fixed display rate: 1 USD = 0.71 JOD.",
  HKD: "Display rate: 1 USD = 7.80 HKD, the midpoint of the 7.75–7.85 band.",
};

const RATE_NUMBER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});
const RATE_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function currencyPerUsd(
  currency: UsageCurrency,
  exchangeRates?: ExchangeRateSnapshot,
): number | null {
  const fixedRate = CURRENCY_PER_USD[currency];
  if (fixedRate !== undefined) return fixedRate;
  const liveRate = exchangeRates?.rates[currency];
  return liveRate !== undefined && Number.isFinite(liveRate) && liveRate > 0 ? liveRate : null;
}

export function convertUsd(
  value: number,
  currency: UsageCurrency,
  exchangeRates?: ExchangeRateSnapshot,
): number | null {
  const rate = currencyPerUsd(currency, exchangeRates);
  return rate === null ? null : value * rate;
}

export function usageCurrencyRateNote(
  currency: UsageCurrency,
  exchangeRates: ExchangeRateSnapshot,
): string {
  const fixedNote = FIXED_CURRENCY_RATE_NOTES[currency];
  if (fixedNote !== undefined) return fixedNote;

  const rate = currencyPerUsd(currency, exchangeRates);
  if (rate === null) {
    return `The daily ${currency} rate is unavailable. Connect to the internet and refresh usage.`;
  }
  const rateDate = exchangeRates.rateDates[currency];
  const status = exchangeRates.status === "fresh" ? "Daily rate" : "Last known daily rate";
  const dateNote =
    rateDate === undefined ? "" : ` for ${RATE_DATE.format(new Date(`${rateDate}T12:00:00Z`))}`;
  return `${status}${dateNote}: 1 USD = ${RATE_NUMBER.format(rate)} ${currency}. Source: Frankfurter.`;
}
