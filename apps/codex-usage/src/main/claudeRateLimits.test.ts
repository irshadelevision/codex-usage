import { describe, expect, it, vi } from "vite-plus/test";
import {
  ClaudeRateLimitReader,
  parseClaudeCredential,
  parseClaudeUsage,
} from "./claudeRateLimits.ts";

const now = Date.parse("2026-09-25T12:00:00Z");
const readAt = new Date(now).toISOString();
const credential = {
  accessToken: "test-token-only",
  expiresAt: now + 3_600_000,
  scopes: ["user:profile"],
};
const payload = {
  five_hour: { utilization: 24.6, resets_at: "2026-09-25T15:00:00Z" },
  seven_day: { utilization: 80, resets_at: "2026-09-28T12:00:00Z" },
};

describe("Claude quota parsing", () => {
  it("maps separate 5-hour and weekly remaining quotas and reset dates", () => {
    const result = parseClaudeUsage(payload, readAt);
    expect(result.status).toBe("available");
    expect(result.fiveHour).toMatchObject({
      remainingPercent: 75,
      usedPercent: 25,
      windowDurationMins: 300,
      resetsAt: "2026-09-25T15:00:00.000Z",
    });
    expect(result.weekly).toMatchObject({ remainingPercent: 20, windowDurationMins: 10_080 });
  });
  it("allows either window independently without inventing a missing quota", () => {
    expect(parseClaudeUsage({ seven_day: payload.seven_day }, readAt)).toMatchObject({
      status: "available",
      fiveHour: null,
    });
    expect(parseClaudeUsage({ five_hour: payload.five_hour }, readAt)).toMatchObject({
      status: "available",
      weekly: null,
    });
  });
  it("handles zero, exhausted, malformed percentages and invalid reset dates", () => {
    expect(parseClaudeUsage({ five_hour: { utilization: 0 } }, readAt).fiveHour).toMatchObject({
      remainingPercent: 100,
      resetsAt: null,
    });
    expect(
      parseClaudeUsage({ five_hour: { utilization: 120, resets_at: "bad" } }, readAt).fiveHour,
    ).toMatchObject({ remainingPercent: 0, resetsAt: null });
    for (const utilization of [null, undefined, "42", Number.NaN, Infinity]) {
      expect(parseClaudeUsage({ five_hour: { utilization } }, readAt).fiveHour).toBeNull();
    }
    expect(parseClaudeUsage({}, readAt).status).toBe("unavailable");
  });
  it("reads only Claude sign-in credentials, not MCP tokens or refresh tokens", () => {
    expect(
      parseClaudeCredential(
        JSON.stringify({ claudeAiOauth: { ...credential, refreshToken: "never-return" } }),
      ),
    ).toEqual(credential);
    expect(parseClaudeCredential('{"mcpOAuth":{"accessToken":"not-a-login"}}')).toBeNull();
    expect(parseClaudeCredential("invalid-json")).toBeNull();
  });
});

describe("Claude rate-limit reader", () => {
  it("uses the fixed usage endpoint, keeps secrets out of results, and caches background reads", async () => {
    const fetchUsage = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const reader = new ClaudeRateLimitReader({ credential: async () => credential, fetchUsage });
    const result = await reader.read(now);
    expect(result.status).toBe("available");
    expect(fetchUsage).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token-only",
          "anthropic-beta": "oauth-2025-04-20",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(credential.accessToken);
    expect(await reader.read(now + 60_000)).toBe(result);
    expect(fetchUsage).toHaveBeenCalledTimes(1);
  });
  it("coalesces concurrent requests", async () => {
    const fetchUsage = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const reader = new ClaudeRateLimitReader({ credential: async () => credential, fetchUsage });
    const [a, b] = await Promise.all([reader.read(now), reader.read(now)]);
    expect(a).toBe(b);
    expect(fetchUsage).toHaveBeenCalledTimes(1);
  });
  it("does not request usage for missing, expired or inference-only credentials", async () => {
    const fetchUsage = vi.fn<typeof fetch>();
    for (const value of [
      null,
      { ...credential, expiresAt: now - 1 },
      { ...credential, scopes: ["user:inference"] },
    ]) {
      const reader = new ClaudeRateLimitReader({ credential: async () => value, fetchUsage });
      expect((await reader.read(now)).status).toBe("unavailable");
    }
    expect(fetchUsage).not.toHaveBeenCalled();
  });
  it("preserves timestamped stale values on network failure and never leaks upstream errors", async () => {
    const fetchUsage = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockRejectedValueOnce(new Error("test-token-only secret upstream error"));
    const reader = new ClaudeRateLimitReader({ credential: async () => credential, fetchUsage });
    await reader.read(now);
    const result = await reader.read(now + 1, true);
    expect(result).toMatchObject({ status: "stale", readAt, fiveHour: { remainingPercent: 75 } });
    expect(JSON.stringify(result)).not.toContain("test-token-only");
  });
  it.each([401, 403])("clears stale quotas on authentication rejection (%s)", async (status) => {
    const fetchUsage = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response("secret body", { status }));
    const reader = new ClaudeRateLimitReader({ credential: async () => credential, fetchUsage });
    await reader.read(now);
    expect(await reader.read(now + 1, true)).toMatchObject({
      status: "unavailable",
      fiveHour: null,
      weekly: null,
    });
  });
  it("does not carry stale quotas across account/token changes", async () => {
    let current = credential;
    const fetchUsage = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockRejectedValueOnce(new Error("offline"));
    const reader = new ClaudeRateLimitReader({ credential: async () => current, fetchUsage });
    await reader.read(now);
    current = { ...credential, accessToken: "another-account" };
    expect(await reader.read(now + 1, true)).toMatchObject({
      status: "unavailable",
      fiveHour: null,
      weekly: null,
    });
  });
  it("backs off background reads after rate limiting and handles malformed responses", async () => {
    const fetchUsage = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response("not json"));
    const reader = new ClaudeRateLimitReader({ credential: async () => credential, fetchUsage });
    expect((await reader.read(now)).status).toBe("unavailable");
    await reader.read(now + 60_000);
    expect(fetchUsage).toHaveBeenCalledTimes(1);
    expect((await reader.read(now + 300_000)).status).toBe("unavailable");
    expect(fetchUsage).toHaveBeenCalledTimes(2);
  });
});
