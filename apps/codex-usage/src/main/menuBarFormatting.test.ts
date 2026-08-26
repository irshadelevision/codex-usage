import { describe, expect, it } from "vite-plus/test";

import { formatMenuBarUsd } from "./menuBarFormatting.ts";

describe("formatMenuBarUsd", () => {
  it("formats costs below 100 with cents", () => {
    expect(formatMenuBarUsd(42.5)).toBe("$42.50");
  });

  it("formats costs at or above 100 without an invalid fraction range", () => {
    expect(formatMenuBarUsd(100)).toBe("$100");
    expect(formatMenuBarUsd(1_234.56)).toBe("$1,235");
  });
});
