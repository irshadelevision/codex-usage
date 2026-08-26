import * as NodePath from "node:path";

import { BrowserWindow, Tray, app, nativeImage, screen, type NativeImage } from "electron";

import type {
  MenuBarDisplay,
  RangeSummary,
  UsagePreferences,
  UsageSnapshot,
} from "../shared/types.ts";
import {
  formatMenuBarCurrency,
  formatRateLimitStatus,
  getMenuBarPopoverPosition,
  shouldShowMenuBarIcon,
} from "./menuBarFormatting.ts";

const TOKEN_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});

function reportPopoverFailure(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`[Codex Usage] Menu bar popover failed: ${message}`);
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

function formatRangeDisplay(
  summary: RangeSummary,
  display: MenuBarDisplay,
  currency: UsagePreferences["currency"],
  exchangeRates: UsageSnapshot["exchangeRates"],
): string {
  if (display === "tokens") return formatTokens(summary.totalTokens);
  if (display === "sessions") return new Intl.NumberFormat("en-US").format(summary.sessions);
  return formatMenuBarCurrency(summary.costUsd, currency, exchangeRates);
}

function usesCountdown(display: MenuBarDisplay): boolean {
  return (
    display === "codex-weekly-time" ||
    display === "codex-reset" ||
    display === "spark-weekly-time" ||
    display === "spark-reset"
  );
}

function formatSparkStatus(value: string): string {
  return value === "—" ? value : `S ${value}`;
}

function formatStatusTitle(
  snapshot: UsageSnapshot,
  preferences: UsagePreferences,
  nowMs: number,
): string {
  if (preferences.menuBarDisplay === "icon-only") return "";
  if (preferences.menuBarDisplay === "codex-weekly") {
    return formatRateLimitStatus(snapshot.rateLimits.codex, "usage", nowMs);
  }
  if (preferences.menuBarDisplay === "codex-weekly-time") {
    return formatRateLimitStatus(snapshot.rateLimits.codex, "usage-time", nowMs);
  }
  if (preferences.menuBarDisplay === "codex-weekly-date") {
    return formatRateLimitStatus(snapshot.rateLimits.codex, "usage-date", nowMs);
  }
  if (preferences.menuBarDisplay === "spark-weekly") {
    return formatSparkStatus(formatRateLimitStatus(snapshot.rateLimits.spark, "usage", nowMs));
  }
  if (preferences.menuBarDisplay === "spark-weekly-time") {
    return formatSparkStatus(formatRateLimitStatus(snapshot.rateLimits.spark, "usage-time", nowMs));
  }
  if (preferences.menuBarDisplay === "spark-weekly-date") {
    return formatSparkStatus(formatRateLimitStatus(snapshot.rateLimits.spark, "usage-date", nowMs));
  }
  if (preferences.menuBarDisplay === "codex-reset") {
    return formatRateLimitStatus(snapshot.rateLimits.codex, "time-date", nowMs);
  }
  if (preferences.menuBarDisplay === "spark-reset") {
    return formatSparkStatus(formatRateLimitStatus(snapshot.rateLimits.spark, "time-date", nowMs));
  }
  return formatRangeDisplay(
    snapshot.ranges[preferences.menuBarRange],
    preferences.menuBarDisplay,
    preferences.currency,
    snapshot.exchangeRates,
  );
}

interface MenuBarControllerInput {
  readonly createPopoverWindow: () => BrowserWindow;
  readonly loadPopoverWindow: (window: BrowserWindow) => Promise<void>;
}

export class MenuBarController {
  readonly #input: MenuBarControllerInput;
  #tray: Tray | null = null;
  #popover: BrowserWindow | null = null;
  #popoverLoad: Promise<void> | null = null;
  #menuBarIcon: NativeImage | null = null;
  #hiddenMenuBarIcon: NativeImage | null = null;
  #iconVisible: boolean | null = null;
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
      this.#menuBarIcon ??= createMenuBarIcon();
      this.#hiddenMenuBarIcon ??= nativeImage.createEmpty();
      const iconVisible = shouldShowMenuBarIcon(
        preferences.showMenuBarIcon,
        preferences.menuBarDisplay,
      );
      this.#tray = new Tray(iconVisible ? this.#menuBarIcon : this.#hiddenMenuBarIcon);
      this.#iconVisible = iconVisible;
      this.#tray.setToolTip("Codex Usage");
      this.#tray.setIgnoreDoubleClickEvents(true);
      this.#tray.on("click", () => {
        void this.#togglePopover().catch(reportPopoverFailure);
      });
      this.#tray.on("right-click", () => {
        void this.#togglePopover().catch(reportPopoverFailure);
      });
    }
    this.#syncCountdownTimer();
    this.#renderStatusItem();
  }

  hidePopover() {
    this.#popover?.hide();
  }

  destroy() {
    if (this.#countdownTimer !== null) clearInterval(this.#countdownTimer);
    this.#countdownTimer = null;
    this.#popover?.destroy();
    this.#popover = null;
    this.#popoverLoad = null;
    this.#tray?.destroy();
    this.#tray = null;
    this.#iconVisible = null;
  }

  #syncCountdownTimer() {
    const shouldRun = this.#preferences !== null && usesCountdown(this.#preferences.menuBarDisplay);
    if (shouldRun && this.#countdownTimer === null) {
      this.#countdownTimer = setInterval(() => this.#renderStatusItem(), 60_000);
      this.#countdownTimer.unref();
    } else if (!shouldRun && this.#countdownTimer !== null) {
      clearInterval(this.#countdownTimer);
      this.#countdownTimer = null;
    }
  }

  async #togglePopover() {
    const popover = await this.#ensurePopover();
    if (popover.isDestroyed()) return;
    if (popover.isVisible()) {
      popover.hide();
      return;
    }

    const tray = this.#tray;
    if (tray === null || tray.isDestroyed()) return;
    const anchor = tray.getBounds();
    const anchorCenter = {
      x: Math.round(anchor.x + anchor.width / 2),
      y: Math.round(anchor.y + anchor.height / 2),
    };
    const workArea = screen.getDisplayNearestPoint(anchorCenter).workArea;
    const position = getMenuBarPopoverPosition(anchor, workArea, popover.getBounds());
    popover.setPosition(position.x, position.y, false);
    popover.show();
    popover.focus();
  }

  async #ensurePopover(): Promise<BrowserWindow> {
    if (this.#popover !== null && !this.#popover.isDestroyed()) {
      if (this.#popoverLoad !== null) await this.#popoverLoad;
      return this.#popover;
    }

    const popover = this.#input.createPopoverWindow();
    this.#popover = popover;
    popover.on("blur", () => {
      if (!popover.webContents.isDevToolsOpened()) popover.hide();
    });
    popover.on("closed", () => {
      if (this.#popover === popover) {
        this.#popover = null;
        this.#popoverLoad = null;
      }
    });
    popover.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    const load = this.#input.loadPopoverWindow(popover);
    this.#popoverLoad = load;
    try {
      await load;
    } catch (cause) {
      if (!popover.isDestroyed()) popover.destroy();
      throw cause;
    } finally {
      if (this.#popover === popover) this.#popoverLoad = null;
    }
    return popover;
  }

  #renderStatusItem() {
    const tray = this.#tray;
    const preferences = this.#preferences;
    if (tray === null || preferences === null) return;

    const snapshot = this.#snapshot;
    const statusTitle =
      snapshot === null ? "—" : formatStatusTitle(snapshot, preferences, Date.now());
    const iconVisible = shouldShowMenuBarIcon(
      preferences.showMenuBarIcon,
      preferences.menuBarDisplay,
    );
    if (iconVisible !== this.#iconVisible) {
      this.#menuBarIcon ??= createMenuBarIcon();
      this.#hiddenMenuBarIcon ??= nativeImage.createEmpty();
      tray.setImage(iconVisible ? this.#menuBarIcon : this.#hiddenMenuBarIcon);
      this.#iconVisible = iconVisible;
    }
    tray.setTitle(statusTitle.length === 0 ? "" : ` ${statusTitle}`);
  }
}
