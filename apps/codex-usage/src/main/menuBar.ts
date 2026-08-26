import * as NodePath from "node:path";

import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from "electron";

import type {
  CodexWeeklyRateLimit,
  MenuBarDisplay,
  RangeSummary,
  UsagePreferences,
  UsagePreferencesPatch,
  UsageRange,
  UsageSnapshot,
} from "../shared/types.ts";
import { formatMenuBarReset, formatResetDateTime } from "../shared/resetTime.ts";
import { MENU_BAR_DISPLAYS } from "../shared/types.ts";
import { formatMenuBarUsd } from "./menuBarFormatting.ts";

const RANGE_LABELS: Record<UsageRange, string> = {
  "24h": "Past 24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

const DISPLAY_LABELS: Record<MenuBarDisplay, string> = {
  cost: "Estimated cost",
  tokens: "Processed tokens",
  sessions: "Sessions",
  "codex-weekly": "Codex weekly remaining",
  "codex-reset": "Codex reset time + date",
  "spark-weekly": "Spark weekly remaining",
  "spark-reset": "Spark reset time + date",
  "icon-only": "Icon only",
};

const TOKEN_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});
function runMenuAction(action: Promise<unknown>) {
  void action.catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[Codex Usage] Menu action failed: ${message}`);
  });
}

function createMenuBarIcon() {
  const candidates = [
    NodePath.join(process.resourcesPath, "assets", "trayTemplate.png"),
    NodePath.join(app.getAppPath(), "assets", "trayTemplate.png"),
  ];
  for (const path of candidates) {
    const image = nativeImage.createFromPath(path);
    if (!image.isEmpty()) {
      image.setTemplateImage(true);
      return image;
    }
  }
  return nativeImage.createEmpty();
}

function formatTokens(value: number): string {
  return TOKEN_FORMAT.format(value);
}

function formatRangeDisplay(summary: RangeSummary, display: MenuBarDisplay): string {
  if (display === "tokens") return formatTokens(summary.totalTokens);
  if (display === "sessions") return new Intl.NumberFormat("en-US").format(summary.sessions);
  return formatMenuBarUsd(summary.costUsd);
}

function formatWeeklyLimit(limit: CodexWeeklyRateLimit | null, nowMs: number): string {
  if (limit === null) return "Unavailable";
  const reset = formatMenuBarReset(limit.resetsAt, nowMs);
  return reset === "—"
    ? `${limit.remainingPercent}% remaining`
    : `${limit.remainingPercent}% remaining · ${reset}`;
}

function formatReset(limit: CodexWeeklyRateLimit | null): string {
  return limit === null ? "Reset date unavailable" : formatResetDateTime(limit.resetsAt);
}

function isRangeDisplay(display: MenuBarDisplay): boolean {
  return display === "cost" || display === "tokens" || display === "sessions";
}

function isResetDisplay(display: MenuBarDisplay): boolean {
  return display === "codex-reset" || display === "spark-reset";
}

function formatStatusTitle(
  snapshot: UsageSnapshot,
  preferences: UsagePreferences,
  nowMs: number,
): string {
  if (preferences.menuBarDisplay === "icon-only") return "";
  if (preferences.menuBarDisplay === "codex-weekly") {
    const limit = snapshot.rateLimits.codex;
    return limit === null ? "—" : `${limit.remainingPercent}%`;
  }
  if (preferences.menuBarDisplay === "spark-weekly") {
    const limit = snapshot.rateLimits.spark;
    return limit === null ? "—" : `S ${limit.remainingPercent}%`;
  }
  if (preferences.menuBarDisplay === "codex-reset") {
    return formatMenuBarReset(snapshot.rateLimits.codex?.resetsAt ?? null, nowMs);
  }
  if (preferences.menuBarDisplay === "spark-reset") {
    const value = formatMenuBarReset(snapshot.rateLimits.spark?.resetsAt ?? null, nowMs);
    return value === "—" ? value : `S ${value}`;
  }
  return formatRangeDisplay(snapshot.ranges[preferences.menuBarRange], preferences.menuBarDisplay);
}

function titleCase(value: string): string {
  if (value === "unknown") return "Unknown";
  if (value === "xhigh") return "Xhigh";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface MenuBarControllerInput {
  readonly openWindow: () => void;
  readonly refresh: () => Promise<void>;
  readonly updatePreferences: (patch: UsagePreferencesPatch) => Promise<void>;
  readonly quit: () => void;
}

export class MenuBarController {
  readonly #input: MenuBarControllerInput;
  #tray: Tray | null = null;
  #snapshot: UsageSnapshot | null = null;
  #preferences: UsagePreferences | null = null;
  #countdownTimer: NodeJS.Timeout | null = null;

  constructor(input: MenuBarControllerInput) {
    this.#input = input;
  }

  sync(snapshot: UsageSnapshot | null, preferences: UsagePreferences) {
    this.#snapshot = snapshot;
    this.#preferences = preferences;
    if (!preferences.showInMenuBar) {
      this.destroy();
      return;
    }
    if (this.#tray === null) {
      this.#tray = new Tray(createMenuBarIcon());
      this.#tray.setToolTip("Codex Usage");
      this.#tray.on("click", () => this.#tray?.popUpContextMenu());
    }
    this.#syncCountdownTimer();
    this.#render();
  }

  destroy() {
    if (this.#countdownTimer !== null) clearInterval(this.#countdownTimer);
    this.#countdownTimer = null;
    this.#tray?.destroy();
    this.#tray = null;
  }

  #syncCountdownTimer() {
    const shouldRun =
      this.#preferences !== null && isResetDisplay(this.#preferences.menuBarDisplay);
    if (shouldRun && this.#countdownTimer === null) {
      this.#countdownTimer = setInterval(() => this.#render(), 60_000);
      this.#countdownTimer.unref();
    } else if (!shouldRun && this.#countdownTimer !== null) {
      clearInterval(this.#countdownTimer);
      this.#countdownTimer = null;
    }
  }

  #render() {
    const tray = this.#tray;
    const preferences = this.#preferences;
    if (tray === null || preferences === null) return;

    const snapshot = this.#snapshot;
    const nowMs = Date.now();
    const selected = snapshot?.ranges[preferences.menuBarRange];
    const statusTitle = snapshot === null ? "—" : formatStatusTitle(snapshot, preferences, nowMs);
    tray.setTitle(statusTitle.length === 0 ? "" : ` ${statusTitle}`);

    const summaryDisplay = isRangeDisplay(preferences.menuBarDisplay)
      ? preferences.menuBarDisplay
      : "cost";

    const summaryRows: MenuItemConstructorOptions[] = snapshot
      ? (Object.entries(RANGE_LABELS) as [UsageRange, string][]).map(([range, label]) => ({
          label,
          sublabel: formatRangeDisplay(snapshot.ranges[range], summaryDisplay),
          enabled: false,
        }))
      : [{ label: "Scanning local Codex sessions…", enabled: false }];
    const topModel = selected?.models[0]?.key ?? "No activity";
    const topMode = selected?.modes[0]?.key ?? "No activity";

    const template: MenuItemConstructorOptions[] = [
      { label: "Codex Usage", enabled: false },
      { type: "separator" },
      {
        label: "Codex usage · weekly",
        sublabel:
          snapshot === null
            ? "Reading account limits…"
            : formatWeeklyLimit(snapshot.rateLimits.codex, nowMs),
        toolTip:
          snapshot === null ? "Reading account limits…" : formatReset(snapshot.rateLimits.codex),
        enabled: false,
      },
      {
        label: "Spark usage · weekly",
        sublabel:
          snapshot === null
            ? "Reading account limits…"
            : formatWeeklyLimit(snapshot.rateLimits.spark, nowMs),
        toolTip:
          snapshot === null ? "Reading account limits…" : formatReset(snapshot.rateLimits.spark),
        enabled: false,
      },
      { type: "separator" },
      ...summaryRows,
      { type: "separator" },
      { label: "Top model", sublabel: topModel, enabled: false },
      { label: "Top mode", sublabel: titleCase(topMode), enabled: false },
      { type: "separator" },
      {
        label: "Menu Bar Range",
        enabled: isRangeDisplay(preferences.menuBarDisplay),
        submenu: (Object.entries(RANGE_LABELS) as [UsageRange, string][]).map(([range, label]) => ({
          label,
          type: "radio" as const,
          checked: preferences.menuBarRange === range,
          click: () => runMenuAction(this.#input.updatePreferences({ menuBarRange: range })),
        })),
      },
      {
        label: "Menu Bar Display",
        submenu: MENU_BAR_DISPLAYS.map((display) => ({
          label: DISPLAY_LABELS[display],
          type: "radio" as const,
          checked: preferences.menuBarDisplay === display,
          click: () => runMenuAction(this.#input.updatePreferences({ menuBarDisplay: display })),
        })),
      },
      { type: "separator" },
      {
        label: "Refresh",
        accelerator: "CmdOrCtrl+R",
        click: () => runMenuAction(this.#input.refresh()),
      },
      {
        label: "Open Codex Usage",
        accelerator: "CmdOrCtrl+O",
        click: this.#input.openWindow,
      },
      { type: "separator" },
      {
        label: "Launch at Login",
        type: "checkbox",
        checked: preferences.launchAtLogin,
        click: (item) =>
          runMenuAction(this.#input.updatePreferences({ launchAtLogin: item.checked })),
      },
      {
        label: "Show in Menu Bar",
        type: "checkbox",
        checked: preferences.showInMenuBar,
        click: (item) =>
          runMenuAction(this.#input.updatePreferences({ showInMenuBar: item.checked })),
      },
      { type: "separator" },
      { label: "Quit", accelerator: "CmdOrCtrl+Q", click: this.#input.quit },
    ];

    tray.setContextMenu(Menu.buildFromTemplate(template));
  }
}
