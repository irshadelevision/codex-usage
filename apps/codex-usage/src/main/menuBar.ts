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
  "spark-weekly": "Spark weekly remaining",
  "icon-only": "Icon only",
};

const TOKEN_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});
const RESET_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
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

function formatWeeklyLimit(limit: CodexWeeklyRateLimit | null): string {
  return limit === null ? "Unavailable" : `${limit.remainingPercent}% remaining`;
}

function formatReset(limit: CodexWeeklyRateLimit | null): string {
  if (limit?.resetsAt === null || limit === null) return "Reset time unavailable";
  const resetAt = new Date(limit.resetsAt);
  if (Number.isNaN(resetAt.getTime())) return "Reset time unavailable";
  return `Resets ${RESET_FORMAT.format(resetAt)}`;
}

function isRangeDisplay(display: MenuBarDisplay): boolean {
  return display === "cost" || display === "tokens" || display === "sessions";
}

function formatStatusTitle(snapshot: UsageSnapshot, preferences: UsagePreferences): string {
  if (preferences.menuBarDisplay === "icon-only") return "";
  if (preferences.menuBarDisplay === "codex-weekly") {
    const limit = snapshot.rateLimits.codex;
    return limit === null ? "—" : `${limit.remainingPercent}%`;
  }
  if (preferences.menuBarDisplay === "spark-weekly") {
    const limit = snapshot.rateLimits.spark;
    return limit === null ? "—" : `S ${limit.remainingPercent}%`;
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
    this.#render();
  }

  destroy() {
    this.#tray?.destroy();
    this.#tray = null;
  }

  #render() {
    const tray = this.#tray;
    const preferences = this.#preferences;
    if (tray === null || preferences === null) return;

    const snapshot = this.#snapshot;
    const selected = snapshot?.ranges[preferences.menuBarRange];
    const statusTitle = snapshot === null ? "—" : formatStatusTitle(snapshot, preferences);
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
            : formatWeeklyLimit(snapshot.rateLimits.codex),
        toolTip:
          snapshot === null ? "Reading account limits…" : formatReset(snapshot.rateLimits.codex),
        enabled: false,
      },
      {
        label: "Spark usage · weekly",
        sublabel:
          snapshot === null
            ? "Reading account limits…"
            : formatWeeklyLimit(snapshot.rateLimits.spark),
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
