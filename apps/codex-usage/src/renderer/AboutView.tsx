import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import appIconUrl from "../../build/icon.png";
import type { AppInfo, UpdateCheckResult } from "../shared/types.ts";
import { api } from "./api.ts";

type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "result"; readonly value: UpdateCheckResult }
  | { readonly kind: "error"; readonly message: string };

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unknown update-check failure";
}

function updateMessage(state: UpdateState): string {
  if (state.kind === "checking") return "Checking the latest GitHub release…";
  if (state.kind === "error") return `Update check failed: ${state.message}`;
  if (state.kind === "result") {
    if (!state.value.updateAvailable) {
      return `You’re up to date with version ${state.value.currentVersion}.`;
    }
    return state.value.downloadUrl === null
      ? `Version ${state.value.latestVersion} is available. Open the release to download it.`
      : `Version ${state.value.latestVersion} is available for download.`;
  }
  return "Check GitHub to see whether a newer release is available.";
}

export function AboutView() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    let active = true;
    void api
      .getAppInfo()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((cause: unknown) => {
        if (active) setInfoError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  const checkForUpdates = () => {
    setUpdateState({ kind: "checking" });
    void api
      .checkForUpdates()
      .then((value) => setUpdateState({ kind: "result", value }))
      .catch((cause: unknown) => setUpdateState({ kind: "error", message: errorMessage(cause) }));
  };

  const openRelease = (url: string) => {
    void api
      .openRelease(url)
      .catch((cause: unknown) => setUpdateState({ kind: "error", message: errorMessage(cause) }));
  };

  const downloadUpdate = (url: string) => {
    void api
      .downloadUpdate(url)
      .catch((cause: unknown) => setUpdateState({ kind: "error", message: errorMessage(cause) }));
  };

  const result = updateState.kind === "result" ? updateState.value : null;
  const downloadUrl = result?.updateAvailable === true ? result.downloadUrl : null;
  return (
    <main className="about-shell">
      <img className="about-icon" src={appIconUrl} alt="" />
      <h1>{info?.name ?? "Codex Usage"}</h1>
      <p className="about-version">Version {info?.version ?? "—"}</p>
      <p className="about-author">Created by {info?.author ?? "Irshad Ibrahim"}</p>

      <section className="about-update" aria-labelledby="update-heading">
        <h2 id="update-heading">Software Update</h2>
        <p aria-live="polite">{infoError ?? updateMessage(updateState)}</p>
        <div className="about-actions">
          {downloadUrl === null ? (
            <button
              type="button"
              className="primary-button"
              disabled={updateState.kind === "checking"}
              onClick={checkForUpdates}
            >
              {updateState.kind === "checking"
                ? "Checking…"
                : result === null
                  ? "Check for Updates"
                  : "Check Again"}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => downloadUpdate(downloadUrl)}
            >
              Download DMG
              <DownloadIcon size={13} />
            </button>
          )}
          {result === null ? null : (
            <button
              type="button"
              className="secondary-button"
              onClick={() => openRelease(result.releaseUrl)}
            >
              {result.updateAvailable ? "View Release" : "View Latest Release"}
              <ExternalLinkIcon size={13} />
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
