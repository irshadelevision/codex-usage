import type { UpdateCheckResult } from "../shared/types.ts";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/irshadelevision/codex-usage/releases/latest";
const RELEASE_PATH_PREFIX = "/irshadelevision/codex-usage/releases/tag/";
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

type FetchRelease = (input: string, init: RequestInit) => Promise<Response>;

function versionParts(value: string): readonly [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function normalizedVersion(value: string): string | null {
  const parts = versionParts(value);
  return parts === null ? null : parts.join(".");
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (leftParts === null || rightParts === null) {
    throw new Error("The app or release version is not valid.");
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function isTrustedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.startsWith(RELEASE_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

function releaseField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export async function checkForUpdates(
  currentVersion: string,
  fetchRelease: FetchRelease = fetch,
): Promise<UpdateCheckResult> {
  const response = await fetchRelease(LATEST_RELEASE_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Codex-Usage/${currentVersion}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub returned status ${response.status}.`);

  const release: unknown = await response.json();
  const tagName = releaseField(release, "tag_name");
  const releaseUrl = releaseField(release, "html_url");
  const latestVersion = tagName === null ? null : normalizedVersion(tagName);
  if (latestVersion === null || releaseUrl === null || !isTrustedReleaseUrl(releaseUrl)) {
    throw new Error("GitHub returned an invalid latest release.");
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl,
  };
}
