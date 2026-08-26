import { describe, expect, it } from "vite-plus/test";

import {
  checkForUpdates,
  compareVersions,
  isTrustedDownloadUrl,
  isTrustedReleaseUrl,
} from "./updateChecker.ts";

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

describe("isTrustedDownloadUrl", () => {
  it("allows only DMG assets from this repository's release downloads", () => {
    expect(
      isTrustedDownloadUrl(
        "https://github.com/irshadelevision/codex-usage/releases/download/v0.2.0/Codex.Usage-0.2.0-arm64.dmg",
      ),
    ).toBe(true);
    expect(
      isTrustedDownloadUrl(
        "https://github.com/irshadelevision/codex-usage/releases/download/v0.2.0/source.zip",
      ),
    ).toBe(false);
    expect(
      isTrustedDownloadUrl(
        "https://example.com/irshadelevision/codex-usage/releases/download/v0.2.0/app.dmg",
      ),
    ).toBe(false);
    expect(
      isTrustedDownloadUrl(
        "https://github.com/irshadelevision/codex-usage/releases/download/v0.2.0/app.dmg?redirect=evil",
      ),
    ).toBe(false);
  });
});

describe("checkForUpdates", () => {
  it("reads the latest release and selects the matching DMG architecture", async () => {
    const result = await checkForUpdates(
      "0.1.12",
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.2.0",
            html_url: "https://github.com/irshadelevision/codex-usage/releases/tag/v0.2.0",
            assets: [
              {
                name: "Codex.Usage-0.2.0-x64.dmg",
                state: "uploaded",
                browser_download_url:
                  "https://github.com/irshadelevision/codex-usage/releases/download/v0.2.0/Codex.Usage-0.2.0-x64.dmg",
              },
              {
                name: "Codex.Usage-0.2.0-arm64.dmg",
                state: "uploaded",
                browser_download_url:
                  "https://github.com/irshadelevision/codex-usage/releases/download/v0.2.0/Codex.Usage-0.2.0-arm64.dmg",
              },
            ],
          }),
          { status: 200 },
        ),
      "arm64",
    );
    expect(result).toEqual({
      currentVersion: "0.1.12",
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/irshadelevision/codex-usage/releases/tag/v0.2.0",
      downloadUrl:
        "https://github.com/irshadelevision/codex-usage/releases/download/v0.2.0/Codex.Usage-0.2.0-arm64.dmg",
    });
  });

  it("keeps the release usable when no trusted DMG is attached", async () => {
    const result = await checkForUpdates(
      "0.1.12",
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.2.0",
            html_url: "https://github.com/irshadelevision/codex-usage/releases/tag/v0.2.0",
            assets: [
              {
                name: "Codex.Usage-0.2.0-arm64.dmg",
                state: "uploaded",
                browser_download_url: "https://example.com/malicious.dmg",
              },
            ],
          }),
          { status: 200 },
        ),
      "arm64",
    );
    expect(result.downloadUrl).toBeNull();
    expect(result.updateAvailable).toBe(true);
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
