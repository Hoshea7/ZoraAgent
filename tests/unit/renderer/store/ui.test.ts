import { createStore } from "jotai";
import {
  activeMainViewAtom,
  closeSettingsAtom,
  isSettingsOpenAtom,
  openSettingsAtom,
} from "@/renderer/store/ui";
import {
  DEFAULT_WORKSPACE_ID,
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  startNewChatInWorkspaceAtom,
  switchWorkspaceSessionAtom,
} from "@/renderer/store/workspace";

describe("main view navigation", () => {
  it("returns from settings to the view that opened it", () => {
    const store = createStore();
    store.set(activeMainViewAtom, "schedule");

    store.set(openSettingsAtom);
    expect(store.get(activeMainViewAtom)).toBe("settings");
    expect(store.get(isSettingsOpenAtom)).toBe(true);

    store.set(closeSettingsAtom);
    expect(store.get(activeMainViewAtom)).toBe("schedule");
    expect(store.get(isSettingsOpenAtom)).toBe(false);
  });

  it("ignores duplicate open and close actions", () => {
    const store = createStore();

    store.set(openSettingsAtom);
    store.set(openSettingsAtom);
    store.set(closeSettingsAtom);
    store.set(closeSettingsAtom);

    expect(store.get(activeMainViewAtom)).toBe("chat");
  });

  it("returns from scheduled tasks to a new conversation", async () => {
    const store = createStore();
    store.set(currentWorkspaceIdAtom, DEFAULT_WORKSPACE_ID);
    store.set(currentSessionIdAtom, "session-1");
    store.set(activeMainViewAtom, "schedule");

    await store.set(startNewChatInWorkspaceAtom, DEFAULT_WORKSPACE_ID);

    expect(store.get(activeMainViewAtom)).toBe("chat");
    expect(store.get(currentSessionIdAtom)).toBeNull();
  });

  it("returns from scheduled tasks to the selected conversation", async () => {
    const store = createStore();
    store.set(currentWorkspaceIdAtom, DEFAULT_WORKSPACE_ID);
    store.set(activeMainViewAtom, "schedule");

    await store.set(switchWorkspaceSessionAtom, {
      workspaceId: DEFAULT_WORKSPACE_ID,
      sessionId: "session-1",
    });

    expect(store.get(activeMainViewAtom)).toBe("chat");
    expect(store.get(currentSessionIdAtom)).toBe("session-1");
  });
});

describe("sidebar width persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists clamped width to localStorage on set", async () => {
    vi.resetModules();
    const { sidebarWidthAtom } = await import("@/renderer/store/ui");
    const store = createStore();

    store.set(sidebarWidthAtom, 900);
    expect(window.localStorage.getItem("zora:sidebarWidth")).toBe("520");

    store.set(sidebarWidthAtom, 100);
    expect(window.localStorage.getItem("zora:sidebarWidth")).toBe("260");
  });

  it("restores stored width after module reload (app restart)", async () => {
    window.localStorage.setItem("zora:sidebarWidth", "400");

    vi.resetModules();
    const { sidebarWidthAtom } = await import("@/renderer/store/ui");
    const store = createStore();

    expect(store.get(sidebarWidthAtom)).toBe(400);
  });

  it("falls back to default width when nothing is stored", async () => {
    vi.resetModules();
    const { sidebarWidthAtom, SIDEBAR_DEFAULT_WIDTH } = await import(
      "@/renderer/store/ui"
    );
    const store = createStore();

    expect(store.get(sidebarWidthAtom)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
