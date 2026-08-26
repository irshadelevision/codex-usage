import { contextBridge, ipcRenderer } from "electron";

import type {
  AppInfo,
  CodexUsageApi,
  UpdateCheckResult,
  UsagePreferences,
  UsagePreferencesPatch,
  UsageSnapshot,
} from "./shared/types.ts";

const api: CodexUsageApi = {
  getSnapshot: () => ipcRenderer.invoke("usage:get-snapshot") as Promise<UsageSnapshot>,
  refresh: () => ipcRenderer.invoke("usage:refresh") as Promise<UsageSnapshot>,
  getPreferences: () => ipcRenderer.invoke("usage:get-preferences"),
  updatePreferences: (patch: UsagePreferencesPatch) =>
    ipcRenderer.invoke("usage:update-preferences", patch),
  getAppInfo: () => ipcRenderer.invoke("app:get-info") as Promise<AppInfo>,
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates") as Promise<UpdateCheckResult>,
  openMainWindow: () => ipcRenderer.invoke("app:open-main") as Promise<void>,
  openAboutWindow: () => ipcRenderer.invoke("app:open-about") as Promise<void>,
  openRelease: (url: string) => ipcRenderer.invoke("app:open-release", url) as Promise<void>,
  downloadUpdate: (url: string) => ipcRenderer.invoke("app:download-update", url) as Promise<void>,
  closeMenuBarPopover: () => ipcRenderer.invoke("app:close-menu-bar-popover") as Promise<void>,
  quitApp: () => ipcRenderer.invoke("app:quit") as Promise<void>,
  onSnapshot: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, snapshot: UsageSnapshot) =>
      listener(snapshot);
    ipcRenderer.on("usage:snapshot", handle);
    return () => ipcRenderer.removeListener("usage:snapshot", handle);
  },
  onPreferences: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, preferences: UsagePreferences) =>
      listener(preferences);
    ipcRenderer.on("usage:preferences", handle);
    return () => ipcRenderer.removeListener("usage:preferences", handle);
  },
};

contextBridge.exposeInMainWorld("codexUsage", api);
