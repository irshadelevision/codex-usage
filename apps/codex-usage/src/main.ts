import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { app, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";

import type { UsagePreferencesPatch, UsageSnapshot } from "./shared/types.ts";
import { MenuBarController } from "./main/menuBar.ts";
import { PreferencesStore } from "./main/preferences.ts";
import { CodexRateLimitReader } from "./main/rateLimits.ts";
import { CodexUsageScanner } from "./main/scanner.ts";

const currentDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const devUrl = process.env["CODEX_USAGE_DEV_URL"]?.trim();
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) app.quit();

app.setName("Codex Usage");

let mainWindow: BrowserWindow | null = null;
let latestSnapshot: UsageSnapshot | null = null;
let refreshInFlight: Promise<UsageSnapshot> | null = null;
let quitting = false;
let refreshTimer: NodeJS.Timeout | null = null;

const sessionsPath = NodePath.join(
  process.env["CODEX_HOME"]?.trim() || NodePath.join(app.getPath("home"), ".codex"),
  "sessions",
);
const userDataPath = app.getPath("userData");
const preferences = new PreferencesStore(NodePath.join(userDataPath, "preferences.json"));
const rateLimitReader = new CodexRateLimitReader(app.getPath("home"));
const scanner = new CodexUsageScanner({
  sessionsPath,
  scanCachePath: NodePath.join(userDataPath, "usage-scan-cache.json"),
  ratesCachePath: NodePath.join(userDataPath, "usage-model-rates.json"),
});

function broadcast(channel: string, value: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, value);
  }
}

function openWindow() {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function refreshUsage(): Promise<UsageSnapshot> {
  if (refreshInFlight !== null) return refreshInFlight;
  const nowMs = Date.now();
  refreshInFlight = Promise.all([scanner.scan(nowMs), rateLimitReader.read(nowMs)])
    .then(([usage, rateLimits]) => {
      const snapshot = { ...usage, rateLimits } satisfies UsageSnapshot;
      latestSnapshot = snapshot;
      menuBar.sync(snapshot, preferences.get());
      broadcast("usage:snapshot", snapshot);
      return snapshot;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function updatePreferences(patch: UsagePreferencesPatch) {
  const next = await preferences.update(patch);
  app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
  menuBar.sync(latestSnapshot, next);
  broadcast("usage:preferences", next);
  return next;
}

const menuBar = new MenuBarController({
  openWindow,
  refresh: async () => {
    await refreshUsage();
  },
  updatePreferences: async (patch) => {
    await updatePreferences(patch);
  },
  quit: () => {
    quitting = true;
    app.quit();
  },
});

async function createWindow() {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    openWindow();
    return;
  }

  const window = new BrowserWindow({
    title: "Codex Usage",
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    show: false,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: NodePath.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (!quitting && preferences.get().showInMenuBar) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(NodePath.join(currentDirectory, "../dist-renderer/index.html"));
}

function installApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Codex Usage",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Refresh Usage", accelerator: "CmdOrCtrl+R", click: () => void refreshUsage() },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("usage:get-snapshot", () => latestSnapshot ?? refreshUsage());
ipcMain.handle("usage:refresh", () => refreshUsage());
ipcMain.handle("usage:get-preferences", () => preferences.get());
ipcMain.handle("usage:update-preferences", (_event, patch: UsagePreferencesPatch) =>
  updatePreferences(patch),
);

app.on("second-instance", openWindow);
app.on("activate", openWindow);
app.on("before-quit", () => {
  quitting = true;
  if (refreshTimer !== null) clearInterval(refreshTimer);
  menuBar.destroy();
});

async function start() {
  await app.whenReady();
  installApplicationMenu();
  const initialPreferences = await preferences.load();
  app.setLoginItemSettings({ openAtLogin: initialPreferences.launchAtLogin });
  menuBar.sync(null, initialPreferences);
  await createWindow();
  void refreshUsage();

  refreshTimer = setInterval(() => void refreshUsage(), 5 * 60 * 1000);
  refreshTimer.unref();
}

void start();
