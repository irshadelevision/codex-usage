import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { PreferencesStore } from "./preferences.ts";

describe("PreferencesStore", () => {
  it("serializes concurrent updates and persists the combined value", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-usage-prefs-"));
    const path = NodePath.join(directory, "nested", "preferences.json");
    try {
      const store = new PreferencesStore(path);
      await store.load();
      await Promise.all([
        store.update({ showInMenuBar: false }),
        store.update({ launchAtLogin: true }),
        store.update({ menuBarDisplay: "codex-reset" }),
      ]);

      const reloaded = new PreferencesStore(path);
      expect(await reloaded.load()).toMatchObject({
        showInMenuBar: false,
        launchAtLogin: true,
        menuBarDisplay: "codex-reset",
      });
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
});
