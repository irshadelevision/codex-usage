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
  ARS: 2,
  AUD: 2,
  BDT: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CLP: 0,
  CNY: 2,
  COP: 2,
  CZK: 2,
  DKK: 2,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  GHS: 2,
  HUF: 2,
  IDR: 0,
  ILS: 2,
  INR: 2,
  JPY: 0,
  KES: 2,
  KRW: 0,
  KWD: 3,
  LKR: 2,
  MAD: 2,
  MXN: 2,
  MYR: 2,
  NGN: 2,
  NOK: 2,
  NPR: 2,
  NZD: 2,
  PEN: 2,
  PHP: 2,
  PKR: 2,
  PLN: 2,
  RON: 2,
  RUB: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  TRY: 2,
  TWD: 2,
  UAH: 2,
  VND: 0,
  ZAR: 2,
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
  ARS: "ARS — Argentine Peso",
  AUD: "AUD — Australian Dollar",
  BDT: "BDT — Bangladeshi Taka",
  BRL: "BRL — Brazilian Real",
  CAD: "CAD — Canadian Dollar",
  CHF: "CHF — Swiss Franc",
  CLP: "CLP — Chilean Peso",
  CNY: "CNY — Chinese Yuan",
  COP: "COP — Colombian Peso",
  CZK: "CZK — Czech Koruna",
  DKK: "DKK — Danish Krone",
  EGP: "EGP — Egyptian Pound",
  EUR: "EUR — Euro",
  GBP: "GBP — British Pound",
  GHS: "GHS — Ghanaian Cedi",
  HUF: "HUF — Hungarian Forint",
  IDR: "IDR — Indonesian Rupiah",
  ILS: "ILS — Israeli New Shekel",
  INR: "INR — Indian Rupee",
  JPY: "JPY — Japanese Yen",
  KES: "KES — Kenyan Shilling",
  KRW: "KRW — South Korean Won",
  KWD: "KWD — Kuwaiti Dinar",
  LKR: "LKR — Sri Lankan Rupee",
  MAD: "MAD — Moroccan Dirham",
  MXN: "MXN — Mexican Peso",
  MYR: "MYR — Malaysian Ringgit",
  NGN: "NGN — Nigerian Naira",
  NOK: "NOK — Norwegian Krone",
  NPR: "NPR — Nepalese Rupee",
  NZD: "NZD — New Zealand Dollar",
  PEN: "PEN — Peruvian Sol",
  PHP: "PHP — Philippine Peso",
  PKR: "PKR — Pakistani Rupee",
  PLN: "PLN — Polish Zloty",
  RON: "RON — Romanian Leu",
  RUB: "RUB — Russian Ruble",
  SEK: "SEK — Swedish Krona",
  SGD: "SGD — Singapore Dollar",
  THB: "THB — Thai Baht",
  TRY: "TRY — Turkish Lira",
  TWD: "TWD — New Taiwan Dollar",
  UAH: "UAH — Ukrainian Hryvnia",
  VND: "VND — Vietnamese Dong",
  ZAR: "ZAR — South African Rand",
};

export const USAGE_CURRENCY_GROUPS = [
  { label: "North America", currencies: ["USD", "CAD", "MXN"] },
  { label: "South America", currencies: ["ARS", "BRL", "CLP", "COP", "PEN"] },
  {
    label: "Europe",
    currencies: [
      "EUR",
      "GBP",
      "CHF",
      "CZK",
      "DKK",
      "HUF",
      "NOK",
      "PLN",
      "RON",
      "RUB",
      "SEK",
      "TRY",
      "UAH",
    ],
  },
  {
    label: "East Asia & Pacific",
    currencies: [
      "AUD",
      "CNY",
      "HKD",
      "IDR",
      "JPY",
      "KRW",
      "MYR",
      "NZD",
      "PHP",
      "SGD",
      "THB",
      "TWD",
      "VND",
    ],
  },
  { label: "South Asia", currencies: ["BDT", "INR", "LKR", "NPR", "PKR"] },
  {
    label: "Middle East",
    currencies: ["AED", "BHD", "ILS", "JOD", "KWD", "OMR", "QAR", "SAR"],
  },
  { label: "Africa", currencies: ["EGP", "GHS", "KES", "MAD", "NGN", "ZAR"] },
] as const satisfies readonly {
  readonly label: string;
  readonly currencies: readonly UsageCurrency[];
}[];

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
