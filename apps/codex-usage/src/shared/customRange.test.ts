import { describe, expect, it } from "vite-plus/test";
import { validateCustomRange } from "./customRange.ts";

describe("custom range validation", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  it("accepts two years and rejects older, reversed, invalid, or future bounds", () => {
    expect(
      validateCustomRange({ start: "2024-09-12T12:00:00Z", end: "2026-09-12T12:00:00Z" }, now)
        .start,
    ).toBe("2024-09-12T12:00:00.000Z");
    for (const range of [
      { start: "2024-09-11T12:00:00Z", end: "2026-09-12T12:00:00Z" },
      { start: "2026-09-12T12:00:00Z", end: "2026-09-12T11:00:00Z" },
      { start: "invalid", end: "2026-09-12T12:00:00Z" },
      { start: "2026-09-12T11:00:00Z", end: "2026-09-12T13:00:00Z" },
    ])
      expect(() => validateCustomRange(range, now)).toThrow();
  });
});
