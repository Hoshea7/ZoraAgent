import { atom, type Setter } from "jotai";
import type { Workspace, Session, GroupedSessions } from "../types";
import {
  clearDraftStateForSessionAtom,
  clearSessionMessagesAtom,
  messagesAtom,
  sessionMessagesAtom,
  setSessionMessagesAtom,
} from "./chat";

const CURRENT_WORKSPACE_STORAGE_KEY = "zora:currentWorkspaceId";
const DEFAULT_WORKSPACE_ID = "default";

function readStoredWorkspaceId(): string {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_ID;
  }

  const stored = window.localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY);
  return stored && stored.trim().length > 0 ? stored : DEFAULT_WORKSPACE_ID;
}

function persistCurrentWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, workspaceId);
}

function sortSessionsByUpdatedAtDesc(a: Session, b: Session) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function sortWorkspaces(workspaces: Workspace[]): Workspace[] {
  const defaultWorkspace = workspaces.find(
    (workspace) => workspace.id === DEFAULT_WORKSPACE_ID
  );
  const others = workspaces
    .filter((workspace) => workspace.id !== DEFAULT_WORKSPACE_ID)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

  return defaultWorkspace ? [defaultWorkspace, ...others] : others;
}

function resetWorkspaceSurface(set: Setter): void {
  set(sessionsAtom, []);
  set(currentSessionIdAtom, null);
  set(messagesAtom, []);
  set(draftSelectedModelIdAtom, undefined);
  set(clearDraftStateForSessionAtom, "__draft__");
  set(pinnedSessionIdsAtom, new Set<string>());
}

/**
 * 工作区列表
 */
export const workspacesAtom = atom<Workspace[]>([]);

/**
 * 当前工作区 ID
 */
export const currentWorkspaceIdAtom = atom<string>(readStoredWorkspaceId());

/**
 * 会话列表
 */
export const sessionsAtom = atom<Session[]>([]);

/**
 * 当前会话 ID
 */
export const currentSessionIdAtom = atom<string | null>(null);

/**
 * 新会话草稿态的模型覆盖
 */
export const draftSelectedModelIdAtom = atom<string | undefined>(undefined);

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
  return workspaces.find((workspace) => workspace.id === currentId) ?? null;
});

/**
 * 派生：当前会话
 */
export const currentSessionAtom = atom((get) => {
  const sessions = get(sessionsAtom);
  const currentId = get(currentSessionIdAtom);
  return sessions.find((session) => session.id === currentId) ?? null;
});

export const setDraftSelectedModelIdAtom = atom(
  null,
  (_get, set, modelId?: string) => {
    const trimmedModelId = modelId?.trim();
    set(
      draftSelectedModelIdAtom,
      trimmedModelId && trimmedModelId.length > 0 ? trimmedModelId : undefined
    );
  }
);

export const updateSessionMetaInStateAtom = atom(
  null,
  (_get, set, params: { sessionId: string; updates: Partial<Session> }) => {
    set(sessionsAtom, (current) =>
      current.map((session) =>
        session.id === params.sessionId
          ? {
              ...session,
              ...params.updates,
            }
          : session
      )
    );
  }
);

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
    earlier: [],
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

  grouped.pinned.sort(sortSessionsByUpdatedAtDesc);
  grouped.today.sort(sortSessionsByUpdatedAtDesc);
  grouped.earlier.sort(sortSessionsByUpdatedAtDesc);

  return grouped;
});

/**
 * 加载指定工作区的会话列表
 */
export const loadSessionsAtom = atom(
  null,
  async (get, set, workspaceId?: string) => {
    const targetWorkspaceId = workspaceId ?? get(currentWorkspaceIdAtom);
    const sessions = await window.zora.listSessions(targetWorkspaceId);

    if (get(currentWorkspaceIdAtom) === targetWorkspaceId) {
      set(sessionsAtom, sessions);
    }

    return sessions;
  }
);

/**
 * 启动时加载工作区列表，并恢复当前工作区
 */
export const loadWorkspacesAtom = atom(null, async (get, set) => {
  const workspaces = sortWorkspaces(await window.zora.listWorkspaces());
  const storedWorkspaceId = get(currentWorkspaceIdAtom);
  const nextWorkspaceId = workspaces.some(
    (workspace) => workspace.id === storedWorkspaceId
  )
    ? storedWorkspaceId
    : DEFAULT_WORKSPACE_ID;

  set(workspacesAtom, workspaces);
  set(currentWorkspaceIdAtom, nextWorkspaceId);
  persistCurrentWorkspaceId(nextWorkspaceId);
  resetWorkspaceSurface(set);
  await set(loadSessionsAtom, nextWorkspaceId);
});

/**
 * 操作：切换工作区
 */
export const switchWorkspaceAtom = atom(
  null,
  async (get, set, workspaceId: string) => {
    if (workspaceId === get(currentWorkspaceIdAtom)) {
      await set(loadSessionsAtom, workspaceId);
      return;
    }

    set(currentWorkspaceIdAtom, workspaceId);
    persistCurrentWorkspaceId(workspaceId);
    resetWorkspaceSurface(set);
    await set(loadSessionsAtom, workspaceId);
  }
);

/**
 * 操作：创建工作区
 */
export const createWorkspaceAtom = atom(
  null,
  async (
    _get,
    set,
    params: {
      name: string;
      path: string;
    }
  ) => {
    const workspace = await window.zora.createWorkspace(
      params.name,
      params.path
    );

    set(workspacesAtom, (current) => sortWorkspaces([...current, workspace]));
    set(currentWorkspaceIdAtom, workspace.id);
    persistCurrentWorkspaceId(workspace.id);
    resetWorkspaceSurface(set);

    return workspace;
  }
);

/**
 * 操作：删除工作区
 */
export const deleteWorkspaceAtom = atom(
  null,
  async (get, set, workspaceId: string) => {
    await window.zora.deleteWorkspace(workspaceId);

    const remaining = sortWorkspaces(
      get(workspacesAtom).filter((workspace) => workspace.id !== workspaceId)
    );
    set(workspacesAtom, remaining);

    if (get(currentWorkspaceIdAtom) !== workspaceId) {
      return;
    }

    const fallbackWorkspaceId =
      remaining.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)?.id ??
      remaining[0]?.id ??
      DEFAULT_WORKSPACE_ID;

    set(currentWorkspaceIdAtom, fallbackWorkspaceId);
    persistCurrentWorkspaceId(fallbackWorkspaceId);
    resetWorkspaceSurface(set);
    await set(loadSessionsAtom, fallbackWorkspaceId);
  }
);

/**
 * 操作：进入新对话状态（不创建会话）
 * 保留已有会话消息缓存，只清空当前草稿视图
 */
export const startNewChatAtom = atom(null, (_get, set) => {
  set(currentSessionIdAtom, null);
  set(messagesAtom, []);
  set(draftSelectedModelIdAtom, undefined);
  set(clearDraftStateForSessionAtom, "__draft__");
});

/**
 * 操作：创建新会话
 */
export const createSessionAtom = atom(
  null,
  async (get, set, title: string = "新会话") => {
    const workspaceId = get(currentWorkspaceIdAtom);
    const previousSessionId = get(currentSessionIdAtom);
    const meta = await window.zora.createSession(title, workspaceId);

    if (get(currentWorkspaceIdAtom) !== workspaceId) {
      return meta.id;
    }

    set(sessionsAtom, (current) => [meta, ...current]);
    if (previousSessionId === null) {
      set(clearDraftStateForSessionAtom, "__draft__");
    }
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
    const workspaceId = get(currentWorkspaceIdAtom);
    set(currentSessionIdAtom, sessionId);

    const cachedMessages = get(sessionMessagesAtom)[sessionId];
    if (cachedMessages === undefined) {
      const messages = await window.zora.loadMessages(sessionId, workspaceId);
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
  (get, set, sessionId: string) => {
    const workspaceId = get(currentWorkspaceIdAtom);

    set(sessionsAtom, (current) => current.filter((session) => session.id !== sessionId));
    set(pinnedSessionIdsAtom, (current) => {
      if (!current.has(sessionId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    set(clearSessionMessagesAtom, sessionId);
    set(clearDraftStateForSessionAtom, sessionId);

    if (get(currentSessionIdAtom) === sessionId) {
      set(currentSessionIdAtom, null);
      set(messagesAtom, []);
      set(clearDraftStateForSessionAtom, "__draft__");
    }

    window.zora.deleteSession(sessionId, workspaceId).catch((error) => {
      console.error("[workspace] Failed to delete session from disk:", error);
    });
  }
);

/**
 * 操作：更新会话活跃时间（让它浮到同组顶部）
 */
export const touchSessionAtom = atom(null, (_get, set, sessionId: string) => {
  const now = new Date().toISOString();

  set(sessionsAtom, (current) =>
    current.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            updatedAt: now,
          }
        : session
    )
  );
});

/**
 * 操作：重命名会话
 */
export const renameSessionAtom = atom(
  null,
  (get, set, params: { sessionId: string; title: string }) => {
    const workspaceId = get(currentWorkspaceIdAtom);
    const nextTitle = params.title.trim();

    if (!nextTitle) {
      return;
    }

    set(sessionsAtom, (current) =>
      current.map((session) =>
        session.id === params.sessionId
          ? {
              ...session,
              title: nextTitle,
              updatedAt: new Date().toISOString(),
            }
          : session
      )
    );

    window.zora
      .renameSession(params.sessionId, nextTitle, workspaceId)
      .catch((error) => {
        console.error("[workspace] Failed to rename session on disk:", error);
      });
  }
);

/**
 * 操作：切换会话置顶状态
 */
export const togglePinSessionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const pinnedIds = get(pinnedSessionIdsAtom);
    const nextPinnedIds = new Set(pinnedIds);

    if (nextPinnedIds.has(sessionId)) {
      nextPinnedIds.delete(sessionId);
    } else {
      nextPinnedIds.add(sessionId);
    }

    set(pinnedSessionIdsAtom, nextPinnedIds);
  }
);
