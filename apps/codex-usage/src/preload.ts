import { contextBridge, ipcRenderer } from "electron";

import type {
  CodexUsageApi,
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
