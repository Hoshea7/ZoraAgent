import { atom } from "jotai";
import type { Workspace, Session, GroupedSessions } from "../types";
import {
  clearSessionMessagesAtom,
  messagesAtom,
  sessionMessagesAtom,
  setSessionMessagesAtom
} from "./chat";

// 默认工作区（硬编码）
const DEFAULT_WORKSPACES: Workspace[] = [
  { id: "default", name: "默认工作区" }
];

/**
 * 工作区列表
 */
export const workspacesAtom = atom<Workspace[]>(DEFAULT_WORKSPACES);

/**
 * 当前工作区 ID
 */
export const currentWorkspaceIdAtom = atom<string>("default");

/**
 * 会话列表
 */
export const sessionsAtom = atom<Session[]>([]);

/**
 * 当前会话 ID
 */
export const currentSessionIdAtom = atom<string | null>(null);

/**
 * 置顶会话 ID 集合
 */
export const pinnedSessionIdsAtom = atom<Set<string>>(new Set<string>());

/**
 * 派生：当前工作区
 */
export const currentWorkspaceAtom = atom((get) => {
  const workspaces = get(workspacesAtom);
  const currentId = get(currentWorkspaceIdAtom);
  return workspaces.find((w) => w.id === currentId) || null;
});

/**
 * 派生：当前会话
 */
export const currentSessionAtom = atom((get) => {
  const sessions = get(sessionsAtom);
  const currentId = get(currentSessionIdAtom);
  return sessions.find((s) => s.id === currentId) || null;
});

/**
 * 派生：按时间分组的会话
 */
export const groupedSessionsAtom = atom((get) => {
  const sessions = get(sessionsAtom);
  const pinnedIds = get(pinnedSessionIdsAtom);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const grouped: GroupedSessions = {
    pinned: [],
    today: [],
    earlier: []
  };

  for (const session of sessions) {
    if (pinnedIds.has(session.id)) {
      grouped.pinned.push(session);
    } else if (new Date(session.updatedAt) >= today) {
      grouped.today.push(session);
    } else {
      grouped.earlier.push(session);
    }
  }

  return grouped;
});

/**
 * 启动时从磁盘加载会话列表
 */
export const loadSessionsAtom = atom(null, async (_get, set) => {
  const sessions = await window.zora.listSessions();
  set(sessionsAtom, (current) => {
    if (current.length === 0) {
      return sessions;
    }

    const existingIds = new Set(current.map((session) => session.id));
    return [...current, ...sessions.filter((session) => !existingIds.has(session.id))];
  });
});

/**
 * 操作：进入新对话状态（不创建会话）
 * 保留已有会话消息，只清空新对话草稿视图
 */
export const startNewChatAtom = atom(null, (_get, set) => {
  set(currentSessionIdAtom, null);
  set(messagesAtom, []);
});

/**
 * 操作：创建新会话
 */
export const createSessionAtom = atom(
  null,
  async (_get, set, title: string = "新会话") => {
    const meta = await window.zora.createSession(title);
    set(sessionsAtom, (current) => [meta, ...current]);
    set(currentSessionIdAtom, meta.id);
    return meta.id;
  }
);

/**
 * 操作：切换会话
 */
export const switchSessionAtom = atom(
  null,
  async (get, set, sessionId: string) => {
    set(currentSessionIdAtom, sessionId);

    const cachedMessages = get(sessionMessagesAtom)[sessionId];
    if (cachedMessages === undefined) {
      const messages = await window.zora.loadMessages(sessionId);
      if (get(sessionMessagesAtom)[sessionId] === undefined) {
        set(setSessionMessagesAtom, sessionId, messages);
      }
    }
  }
);

/**
 * 操作：删除会话
 */
export const deleteSessionAtom = atom(
  null,
  async (get, set, sessionId: string) => {
    await window.zora.deleteSession(sessionId);
    set(sessionsAtom, (current) => current.filter((s) => s.id !== sessionId));
    set(clearSessionMessagesAtom, sessionId);

    if (get(currentSessionIdAtom) === sessionId) {
      set(currentSessionIdAtom, null);
    }
  }
);

/**
 * 操作：切换会话置顶状态
 */
export const togglePinSessionAtom = atom(null, (get, set, sessionId: string) => {
  const pinnedIds = get(pinnedSessionIdsAtom);
  const newPinnedIds = new Set(pinnedIds);

  if (newPinnedIds.has(sessionId)) {
    newPinnedIds.delete(sessionId);
  } else {
    newPinnedIds.add(sessionId);
  }

  set(pinnedSessionIdsAtom, newPinnedIds);
});
