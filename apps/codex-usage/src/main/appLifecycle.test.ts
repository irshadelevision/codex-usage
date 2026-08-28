import { describe, expect, it, vi } from "vite-plus/test";

import { MenuBarLifecycle } from "./appLifecycle.ts";

describe("MenuBarLifecycle", () => {
  it("redirects ordinary close, minimize, and quit requests to the menu bar", () => {
    const moveToMenuBar = vi.fn();
    const preventDefault = vi.fn();
    const lifecycle = new MenuBarLifecycle(moveToMenuBar);

    expect(lifecycle.intercept({ preventDefault })).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(moveToMenuBar).toHaveBeenCalledOnce();
  });

  it("runs native minimize recovery before moving the window to the menu bar", () => {
    const calls: string[] = [];
    const lifecycle = new MenuBarLifecycle(() => calls.push("move"));

    expect(lifecycle.redirect(() => calls.push("restore"))).toBe(true);
    expect(calls).toEqual(["restore", "move"]);
  });

  it("allows termination only when the quit request comes from the menu-bar popover", () => {
    const moveToMenuBar = vi.fn();
    const preventDefault = vi.fn();
    const lifecycle = new MenuBarLifecycle(moveToMenuBar);

    expect(lifecycle.requestQuit(8, null)).toBe(false);
    expect(lifecycle.requestQuit(8, 9)).toBe(false);
    expect(moveToMenuBar).toHaveBeenCalledTimes(2);
    expect(lifecycle.requestQuit(8, 8)).toBe(true);

    expect(lifecycle.intercept({ preventDefault })).toBe(false);
    expect(lifecycle.redirect()).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(moveToMenuBar).toHaveBeenCalledTimes(2);
  });
});
