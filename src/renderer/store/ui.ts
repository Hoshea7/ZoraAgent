import { atom } from "jotai";

export type MainView = "chat" | "schedule" | "settings";
export type SidebarViewMode = "projects" | "activity";

export const SETTINGS_TAB_IDS = [
  "provider",
  "feishu",
  "skills",
  "memory",
  "vision",
  "mcp",
  "archived",
  "about",
] as const;
export type SettingsTab = (typeof SETTINGS_TAB_IDS)[number];

const SIDEBAR_WIDTH_STORAGE_KEY = "zora:sidebarWidth";
const SIDEBAR_VIEW_MODE_STORAGE_KEY = "zora:sidebarViewMode";

export const SIDEBAR_COLLAPSED_WIDTH = 72;
export const SIDEBAR_MIN_WIDTH = 260;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_DEFAULT_WIDTH = 344;
export const SIDEBAR_TOGGLE_DURATION_MS = 200;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readStoredSidebarWidth(): number {
  if (typeof window === "undefined") {
    return SIDEBAR_DEFAULT_WIDTH;
  }

  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (raw === null) {
    return SIDEBAR_DEFAULT_WIDTH;
  }

  const stored = Number(raw);
  return Number.isFinite(stored)
    ? clampSidebarWidth(stored)
    : SIDEBAR_DEFAULT_WIDTH;
}

function persistSidebarWidth(width: number): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SIDEBAR_WIDTH_STORAGE_KEY,
    String(clampSidebarWidth(width))
  );
}

function readStoredSidebarViewMode(): SidebarViewMode {
  if (typeof window === "undefined") {
    return "projects";
  }

  return window.localStorage.getItem(SIDEBAR_VIEW_MODE_STORAGE_KEY) === "activity"
    ? "activity"
    : "projects";
}

function persistSidebarViewMode(mode: SidebarViewMode): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SIDEBAR_VIEW_MODE_STORAGE_KEY, mode);
}

/**
 * 侧边栏折叠状态
 */
export const sidebarCollapsedAtom = atom(false);

/**
 * 侧边栏展开宽度
 */
const sidebarWidthBaseAtom = atom(readStoredSidebarWidth());
export const sidebarWidthAtom = atom(
  (get) => get(sidebarWidthBaseAtom),
  (_get, set, width: number) => {
    const nextWidth = clampSidebarWidth(width);
    set(sidebarWidthBaseAtom, nextWidth);
    persistSidebarWidth(nextWidth);
  }
);

const sidebarViewModeBaseAtom = atom<SidebarViewMode>(
  readStoredSidebarViewMode(),
);

export const sidebarViewModeAtom = atom(
  (get) => get(sidebarViewModeBaseAtom),
  (_get, set, mode: SidebarViewMode) => {
    set(sidebarViewModeBaseAtom, mode);
    persistSidebarViewMode(mode);
  },
);

export const toggleSidebarViewModeAtom = atom(null, (get, set) => {
  set(
    sidebarViewModeAtom,
    get(sidebarViewModeAtom) === "activity" ? "projects" : "activity",
  );
});

/**
 * 主内容区当前视图
 */
export const activeMainViewAtom = atom<MainView>("chat");

/**
 * 打开设置前所在的主视图，用于关闭设置时回到原视图。
 */
const previousMainViewAtom = atom<MainView>("chat");

export const isSettingsOpenAtom = atom(
  (get) => get(activeMainViewAtom) === "settings"
);

export const openSettingsAtom = atom(null, (get, set) => {
  const current = get(activeMainViewAtom);
  if (current === "settings") {
    return;
  }

  set(previousMainViewAtom, current);
  set(activeMainViewAtom, "settings");
});

export const closeSettingsAtom = atom(null, (get, set) => {
  if (get(activeMainViewAtom) === "settings") {
    set(activeMainViewAtom, get(previousMainViewAtom));
  }
});

/**
 * 设置面板当前 Tab
 */
export const settingsTabAtom = atom<SettingsTab>("provider");
