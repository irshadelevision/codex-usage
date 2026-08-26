import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from "electron";

import type { AppInfo, UsagePreferencesPatch, UsageSnapshot } from "./shared/types.ts";
import { ExchangeRateReader } from "./main/exchangeRates.ts";
import { MENU_BAR_POPOVER_HEIGHT, MenuBarController } from "./main/menuBar.ts";
import { PreferencesStore } from "./main/preferences.ts";
import { CodexRateLimitReader } from "./main/rateLimits.ts";
import { CodexUsageScanner } from "./main/scanner.ts";
import {
  checkForUpdates,
  isTrustedDownloadUrl,
  isTrustedReleaseUrl,
} from "./main/updateChecker.ts";

const currentDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const devUrl = process.env["CODEX_USAGE_DEV_URL"]?.trim();
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) app.quit();

app.setName("Codex Usage");

const APP_AUTHOR = "Irshad Ibrahim";
let mainWindow: BrowserWindow | null = null;
let aboutWindow: BrowserWindow | null = null;
let latestSnapshot: UsageSnapshot | null = null;
let refreshInFlight: Promise<UsageSnapshot> | null = null;
let quitting = false;
let refreshTimer: NodeJS.Timeout | null = null;

function reportBackgroundRefreshFailure(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`[Codex Usage] Background refresh failed: ${message}`);
}

function refreshInBackground() {
  void refreshUsage().catch(reportBackgroundRefreshFailure);
}

const sessionsPath = NodePath.join(
  process.env["CODEX_HOME"]?.trim() || NodePath.join(app.getPath("home"), ".codex"),
  "sessions",
);
const userDataPath = app.getPath("userData");
const preferences = new PreferencesStore(NodePath.join(userDataPath, "preferences.json"));
const exchangeRateReader = new ExchangeRateReader(
  NodePath.join(userDataPath, "currency-rates.json"),
);
const rateLimitReader = new CodexRateLimitReader(app.getPath("home"), app.getVersion());
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

function reportAboutWindowFailure(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`[Codex Usage] About window failed: ${message}`);
}

function openAboutWindowInBackground() {
  void createAboutWindow().catch(reportAboutWindowFailure);
}

async function refreshUsage(forceExchangeRates = false): Promise<UsageSnapshot> {
  if (refreshInFlight !== null) return refreshInFlight;
  const nowMs = Date.now();
  refreshInFlight = Promise.all([
    scanner.scan(nowMs),
    rateLimitReader.read(nowMs),
    exchangeRateReader.read(nowMs, forceExchangeRates),
  ])
    .then(([usage, rateLimits, exchangeRates]) => {
      const snapshot = { ...usage, exchangeRates, rateLimits } satisfies UsageSnapshot;
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
  broadcast("usage:preferences", next);
  if (next.showInMenuBar) {
    menuBar.sync(latestSnapshot, next);
  } else {
    setImmediate(() => menuBar.sync(latestSnapshot, preferences.get()));
  }
  return next;
}

const menuBar = new MenuBarController({
  createPopoverWindow: createMenuBarPopoverWindow,
  loadPopoverWindow: (window) => loadRendererView(window, "menu-bar"),
});

async function loadRendererView(window: BrowserWindow, view?: string) {
  if (devUrl) {
    const url = new URL(devUrl);
    if (view !== undefined) url.searchParams.set("view", view);
    await window.loadURL(url.toString());
    return;
  }
  await window.loadFile(
    NodePath.join(currentDirectory, "../dist-renderer/index.html"),
    view === undefined ? undefined : { query: { view } },
  );
}

function createMenuBarPopoverWindow() {
  const window = new BrowserWindow({
    title: "Codex Usage",
    width: 390,
    height: MENU_BAR_POPOVER_HEIGHT,
    useContentSize: true,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    acceptFirstMouse: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: NodePath.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setAlwaysOnTop(true, "pop-up-menu");
  window.setHiddenInMissionControl(true);
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  return window;
}

async function createWindow() {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    openWindow();
    return;
  }

  const window = new BrowserWindow({
    title: "Codex Usage",
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 540,
    show: false,
    backgroundColor: "#000000",
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

  await loadRendererView(window);
}

async function createAboutWindow() {
  if (aboutWindow !== null && !aboutWindow.isDestroyed()) {
    aboutWindow.show();
    aboutWindow.focus();
    return;
  }

  const parent =
    mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isVisible()
      ? mainWindow
      : undefined;
  const window = new BrowserWindow({
    title: "About Codex Usage",
    ...(parent === undefined ? {} : { parent }),
    width: 420,
    height: 430,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#000000",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: NodePath.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  aboutWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (aboutWindow === window) aboutWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await loadRendererView(window, "about");
}

function installApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Codex Usage",
      submenu: [
        { label: "About Codex Usage", click: openAboutWindowInBackground },
        { type: "separator" },
        { label: "Refresh Usage", accelerator: "CmdOrCtrl+R", click: refreshInBackground },
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
ipcMain.handle("usage:refresh", () => refreshUsage(true));
ipcMain.handle("usage:get-preferences", () => preferences.get());
ipcMain.handle("usage:update-preferences", (_event, patch: UsagePreferencesPatch) =>
  updatePreferences(patch),
);
ipcMain.handle(
  "app:get-info",
  () => ({ name: app.getName(), version: app.getVersion(), author: APP_AUTHOR }) satisfies AppInfo,
);
ipcMain.handle("app:check-for-updates", () => checkForUpdates(app.getVersion()));
ipcMain.handle("app:open-main", () => {
  menuBar.hidePopover();
  openWindow();
});
ipcMain.handle("app:open-about", () => {
  menuBar.hidePopover();
  return createAboutWindow();
});
ipcMain.handle("app:close-menu-bar-popover", () => menuBar.hidePopover());
ipcMain.handle("app:quit", () => {
  quitting = true;
  app.quit();
});
ipcMain.handle("app:open-release", async (_event, url: unknown) => {
  if (typeof url !== "string" || !isTrustedReleaseUrl(url)) {
    throw new Error("The release URL is not trusted.");
  }
  await shell.openExternal(url);
});
ipcMain.handle("app:download-update", async (_event, url: unknown) => {
  if (typeof url !== "string" || !isTrustedDownloadUrl(url)) {
    throw new Error("The update download URL is not trusted.");
  }
  await shell.openExternal(url);
});

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
  refreshInBackground();

  refreshTimer = setInterval(refreshInBackground, 5 * 60 * 1000);
  refreshTimer.unref();
}

void start().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`[Codex Usage] Startup failed: ${message}`);
  dialog.showErrorBox("Codex Usage could not start", message);
  app.quit();
});
