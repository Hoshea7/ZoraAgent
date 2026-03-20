import { atom } from "jotai";
import type { Mode } from "../types";

/**
 * 侧边栏折叠状态
 */
export const sidebarCollapsedAtom = atom(false);

/**
 * 侧边栏展开宽度
 */
export const sidebarWidthAtom = atom(292);

/**
 * 当前模式（Chat 或 Agent）
 */
export const currentModeAtom = atom<Mode>("chat");

/**
 * 设置弹窗开关
 */
export const isSettingsOpenAtom = atom(false);

/**
 * 设置面板当前 Tab
 */
export const settingsTabAtom = atom<"provider" | "feishu" | "skills" | "mcp">("provider");
