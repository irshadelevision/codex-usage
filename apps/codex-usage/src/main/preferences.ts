import * as NodeFSP from "node:fs/promises";

import type {
  MenuBarDisplay,
  UsagePreferences,
  UsagePreferencesPatch,
  UsageRange,
} from "../shared/types.ts";
import { MENU_BAR_DISPLAYS, USAGE_RANGES } from "../shared/types.ts";

const DEFAULT_PREFERENCES: UsagePreferences = {
  showInMenuBar: true,
  launchAtLogin: false,
  menuBarRange: "7d",
  menuBarDisplay: "cost",
};

function isRange(value: unknown): value is UsageRange {
  return typeof value === "string" && USAGE_RANGES.includes(value as UsageRange);
}

function isMenuBarDisplay(value: unknown): value is MenuBarDisplay {
  return typeof value === "string" && MENU_BAR_DISPLAYS.includes(value as MenuBarDisplay);
}

function decodePreferences(value: unknown): UsagePreferences {
  if (typeof value !== "object" || value === null) return DEFAULT_PREFERENCES;
  const input = value as Record<string, unknown>;
  return {
    showInMenuBar:
      typeof input["showInMenuBar"] === "boolean"
        ? input["showInMenuBar"]
        : DEFAULT_PREFERENCES.showInMenuBar,
    launchAtLogin:
      typeof input["launchAtLogin"] === "boolean"
        ? input["launchAtLogin"]
        : DEFAULT_PREFERENCES.launchAtLogin,
    menuBarRange: isRange(input["menuBarRange"])
      ? input["menuBarRange"]
      : DEFAULT_PREFERENCES.menuBarRange,
    menuBarDisplay: isMenuBarDisplay(input["menuBarDisplay"])
      ? input["menuBarDisplay"]
      : input["menuBarMetric"] === "tokens"
        ? "tokens"
        : DEFAULT_PREFERENCES.menuBarDisplay,
  };
}

export class PreferencesStore {
  readonly #path: string;
  #value: UsagePreferences = DEFAULT_PREFERENCES;

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<UsagePreferences> {
    try {
      this.#value = decodePreferences(JSON.parse(await NodeFSP.readFile(this.#path, "utf8")));
    } catch {
      this.#value = DEFAULT_PREFERENCES;
    }
    return this.#value;
  }

  get(): UsagePreferences {
    return this.#value;
  }

  async update(patch: UsagePreferencesPatch): Promise<UsagePreferences> {
    this.#value = decodePreferences({ ...this.#value, ...patch });
    await NodeFSP.writeFile(this.#path, JSON.stringify(this.#value, null, 2), "utf8");
    return this.#value;
  }
}
