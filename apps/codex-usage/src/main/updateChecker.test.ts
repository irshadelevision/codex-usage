import { describe, expect, it } from "vite-plus/test";

import { checkForUpdates, compareVersions, isTrustedReleaseUrl } from "./updateChecker.ts";

describe("compareVersions", () => {
  it("compares semantic release versions", () => {
    expect(compareVersions("0.1.12", "0.1.11")).toBe(1);
    expect(compareVersions("v0.1.12", "0.1.12")).toBe(0);
    expect(compareVersions("0.1.11", "0.1.12")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("rejects malformed versions", () => {
    expect(() => compareVersions("development", "0.1.12")).toThrow("not valid");
  });
});

describe("isTrustedReleaseUrl", () => {
  it("allows only this repository's HTTPS release pages", () => {
    expect(
      isTrustedReleaseUrl("https://github.com/irshadelevision/codex-usage/releases/tag/v0.1.12"),
    ).toBe(true);
    expect(isTrustedReleaseUrl("https://example.com/releases/tag/v0.1.12")).toBe(false);
    expect(
      isTrustedReleaseUrl(
        "https://github.com.evil.test/irshadelevision/codex-usage/releases/tag/x",
      ),
    ).toBe(false);
    expect(isTrustedReleaseUrl("file:///Applications/Calculator.app")).toBe(false);
  });
});

describe("checkForUpdates", () => {
  it("reads and compares the latest GitHub release", async () => {
    const result = await checkForUpdates(
      "0.1.12",
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.2.0",
            html_url: "https://github.com/irshadelevision/codex-usage/releases/tag/v0.2.0",
          }),
          { status: 200 },
        ),
    );
    expect(result).toEqual({
      currentVersion: "0.1.12",
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/irshadelevision/codex-usage/releases/tag/v0.2.0",
    });
  });

  it("reports GitHub and invalid response failures", async () => {
    await expect(
      checkForUpdates("0.1.12", async () => new Response(null, { status: 403 })),
    ).rejects.toThrow("status 403");
    await expect(
      checkForUpdates(
        "0.1.12",
        async () => new Response(JSON.stringify({ tag_name: "latest" }), { status: 200 }),
      ),
    ).rejects.toThrow("invalid latest release");
  });
});
