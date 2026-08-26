import { describe, expect, it } from "vite-plus/test";

import type { UsageCurrency } from "./types.ts";
import { convertUsd } from "./currency.ts";

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
});
