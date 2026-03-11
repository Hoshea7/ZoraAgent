import { atom } from "jotai";
import type { Mode } from "../types";

/**
 * 侧边栏折叠状态
 */
export const sidebarCollapsedAtom = atom(false);

/**
 * 当前模式（Chat 或 Agent）
 */
export const currentModeAtom = atom<Mode>("chat");
