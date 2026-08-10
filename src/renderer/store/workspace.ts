import { atom, type Getter, type Setter } from "jotai";
import type { Workspace, Session } from "../types";
import type { AgentRuntimeType, ReasoningLevel } from "../../shared/types/provider";
import {
  clearDraftStateForSessionAtom,
  clearSessionMessagesAtom,
  messagesAtom,
  sessionMessagesAtom,
  setSessionMessagesAtom,
} from "./chat";
import {
  logSessionStateSynced,
  logSessionStateSyncError,
} from "../utils/client-log";
import { emitArchivedSessionsChanged } from "../utils/archived-sessions-event";
import { getErrorMessage } from "../utils/message";
import { draftKeyForWorkspace } from "./session-constants";
import { draftPermissionModeAtom } from "./permission-mode-state";

const CURRENT_WORKSPACE_STORAGE_KEY = "zora:currentWorkspaceId";
const PINNED_WORKSPACES_STORAGE_KEY = "zora:pinnedWorkspaceIds";
const PINNED_SESSIONS_STORAGE_KEY = "zora:pinnedSessionIds";
export const DEFAULT_WORKSPACE_ID = "default";
const sessionLoadRequestIds = new Map<string, number>();

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

function readStoredStringSet(
  key: string,
  isValidValue: (value: string) => boolean = (value) => value.trim().length > 0
): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === "string" && isValidValue(value)
      )
    );
  } catch {
    return new Set();
  }
}

function persistStoredStringSet(key: string, values: Set<string>): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify([...values]));
}

function readPinnedWorkspaceIds(): Set<string> {
  return readStoredStringSet(
    PINNED_WORKSPACES_STORAGE_KEY,
    (value) => value.trim().length > 0 && value !== DEFAULT_WORKSPACE_ID
  );
}

function persistPinnedWorkspaceIds(workspaceIds: Set<string>): void {
  persistStoredStringSet(PINNED_WORKSPACES_STORAGE_KEY, workspaceIds);
}

function readPinnedSessionIds(): Set<string> {
  return readStoredStringSet(PINNED_SESSIONS_STORAGE_KEY);
}

function persistPinnedSessionIds(sessionIds: Set<string>): void {
  persistStoredStringSet(PINNED_SESSIONS_STORAGE_KEY, sessionIds);
}

function sortSessionsByUpdatedAtDesc(a: Session, b: Session) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function sortSessions(
  sessions: Session[],
  pinnedSessionIds: Set<string> = new Set()
): Session[] {
  return [...sessions].sort((a, b) => {
    const aPinned = pinnedSessionIds.has(a.id);
    const bPinned = pinnedSessionIds.has(b.id);

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    return sortSessionsByUpdatedAtDesc(a, b);
  });
}

function upsertSession(
  sessions: Session[],
  session: Session,
  pinnedSessionIds: Set<string>
): Session[] {
  const existingIndex = sessions.findIndex((item) => item.id === session.id);

  if (existingIndex === -1) {
    return sortSessions([session, ...sessions], pinnedSessionIds);
  }

  const next = [...sessions];
  next[existingIndex] = {
    ...next[existingIndex],
    ...session,
  };
  return sortSessions(next, pinnedSessionIds);
}

function updateSession(
  sessions: Session[],
  sessionId: string,
  updates: Partial<Session>,
  pinnedSessionIds: Set<string>
): Session[] {
  return sortSessions(
    sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            ...updates,
          }
        : session
    ),
    pinnedSessionIds
  );
}

function removeSession(sessions: Session[], sessionId: string): Session[] {
  return sessions.filter((session) => session.id !== sessionId);
}

function setWorkspaceSessions(
  set: Setter,
  workspaceId: string,
  sessions: Session[],
  pinnedSessionIds: Set<string> = new Set()
): Session[] {
  const sortedSessions = sortSessions(sessions, pinnedSessionIds);

  set(workspaceSessionsAtom, (current) => ({
    ...current,
    [workspaceId]: sortedSessions,
  }));

  return sortedSessions;
}

function getNextSessionLoadRequestId(workspaceId: string): number {
  const requestId = (sessionLoadRequestIds.get(workspaceId) ?? 0) + 1;
  sessionLoadRequestIds.set(workspaceId, requestId);
  return requestId;
}

function sortWorkspaces(
  workspaces: Workspace[],
  pinnedWorkspaceIds: Set<string> = new Set()
): Workspace[] {
  const defaultWorkspace = workspaces.find(
    (workspace) => workspace.id === DEFAULT_WORKSPACE_ID
  );
  const sortByUpdatedAtDesc = (a: Workspace, b: Workspace) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  const nonDefaultWorkspaces = workspaces.filter(
    (workspace) => workspace.id !== DEFAULT_WORKSPACE_ID
  );
  const pinned = nonDefaultWorkspaces
    .filter((workspace) => pinnedWorkspaceIds.has(workspace.id))
    .sort(sortByUpdatedAtDesc);
  const others = nonDefaultWorkspaces
    .filter((workspace) => !pinnedWorkspaceIds.has(workspace.id))
    .sort(sortByUpdatedAtDesc);

  return defaultWorkspace
    ? [defaultWorkspace, ...pinned, ...others]
    : [...pinned, ...others];
}

function prunePinnedWorkspaceIds(
  pinnedWorkspaceIds: Set<string>,
  workspaces: Workspace[]
): Set<string> {
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  return new Set(
    [...pinnedWorkspaceIds].filter(
      (workspaceId) =>
        workspaceId !== DEFAULT_WORKSPACE_ID && workspaceIds.has(workspaceId)
    )
  );
}

function prunePinnedSessionIds(
  pinnedSessionIds: Set<string>,
  workspaceSessions: Record<string, Session[]>
): Set<string> {
  const sessionIds = new Set(
    Object.values(workspaceSessions)
      .flat()
      .map((session) => session.id)
  );
  return new Set(
    [...pinnedSessionIds].filter((sessionId) => sessionIds.has(sessionId))
  );
}

function resetWorkspaceSurface(set: Setter): void {
  set(currentSessionIdAtom, null);
  set(messagesAtom, []);
  set(draftSelectedProviderIdAtom, undefined);
  set(draftSelectedModelIdAtom, undefined);
  set(draftReasoningLevelAtom, "high");
}

function removeSessionFromClientState(
  get: Getter,
  set: Setter,
  sessionId: string,
  workspaceId: string
): void {
  set(workspaceSessionsAtom, (current) => ({
    ...current,
    [workspaceId]: removeSession(current[workspaceId] ?? [], sessionId),
  }));
  set(pinnedSessionIdsAtom, (current) => {
    if (!current.has(sessionId)) {
      return current;
    }

    const next = new Set(current);
    next.delete(sessionId);
    persistPinnedSessionIds(next);
    return next;
  });
  set(clearSessionMessagesAtom, sessionId);
  set(clearDraftStateForSessionAtom, sessionId);

  if (
    get(currentWorkspaceIdAtom) === workspaceId &&
    get(currentSessionIdAtom) === sessionId
  ) {
    set(currentSessionIdAtom, null);
    set(messagesAtom, []);
  }
}

/**
 * 工作区列表
 */
export const workspacesAtom = atom<Workspace[]>([]);

/**
 * 置顶工作区 ID 集合。默认工作区固定第一，不进入置顶集合。
 */
export const pinnedWorkspaceIdsAtom = atom<Set<string>>(readPinnedWorkspaceIds());

/**
 * 当前工作区 ID
 */
export const currentWorkspaceIdAtom = atom<string>(readStoredWorkspaceId());

/**
 * 按工作区缓存的会话列表，用于侧边栏直接展示所有工作区下的会话。
 */
export const workspaceSessionsAtom = atom<Record<string, Session[]>>({});

/**
 * 派生：当前工作区会话列表
 */
export const sessionsAtom = atom((get) => {
  const currentWorkspaceId = get(currentWorkspaceIdAtom);
  return get(workspaceSessionsAtom)[currentWorkspaceId] ?? [];
});

/**
 * 当前会话 ID
 */
export const currentSessionIdAtom = atom<string | null>(null);

/**
 * 新会话草稿态的 Provider 覆盖
 */
export const draftSelectedProviderIdAtom = atom<string | undefined>(undefined);

/**
 * 新会话草稿态的模型覆盖
 */
export const draftSelectedModelIdAtom = atom<string | undefined>(undefined);

/**
 * 新会话草稿态的 Runtime，默认使用 Pi
 */
export const draftAgentRuntimeTypeAtom = atom<AgentRuntimeType>("pi");

/**
 * 新会话草稿态的推理强度，默认 medium
 */
export const draftReasoningLevelAtom = atom<ReasoningLevel>("high");

/**
 * 置顶会话 ID 集合
 */
export const pinnedSessionIdsAtom = atom<Set<string>>(readPinnedSessionIds());

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

/**
 * 派生：工作区 + 会话分组
 */
export const workspaceSessionGroupsAtom = atom((get) => {
  const workspaces = get(workspacesAtom);
  const workspaceSessions = get(workspaceSessionsAtom);

  return workspaces.map((workspace) => ({
    workspace,
    sessions: workspaceSessions[workspace.id] ?? [],
    loaded: workspace.id in workspaceSessions,
  }));
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

export const setDraftSelectedProviderIdAtom = atom(
  null,
  (_get, set, providerId?: string) => {
    const trimmedProviderId = providerId?.trim();
    set(
      draftSelectedProviderIdAtom,
      trimmedProviderId && trimmedProviderId.length > 0 ? trimmedProviderId : undefined
    );
  }
);

export const setDraftAgentRuntimeTypeAtom = atom(
  null,
  (_get, set, agentRuntimeType: AgentRuntimeType) => {
    set(draftAgentRuntimeTypeAtom, agentRuntimeType);
  }
);

export const setDraftReasoningLevelAtom = atom(
  null,
  (_get, set, effort: ReasoningLevel) => {
    set(draftReasoningLevelAtom, effort);
  }
);

export const updateSessionMetaInStateAtom = atom(
  null,
  (get, set, params: { sessionId: string; updates: Partial<Session>; workspaceId?: string }) => {
    const targetWorkspaceId = params.workspaceId ?? get(currentWorkspaceIdAtom);

    set(workspaceSessionsAtom, (current) => ({
      ...current,
      [targetWorkspaceId]: updateSession(
        current[targetWorkspaceId] ?? [],
        params.sessionId,
        params.updates,
        get(pinnedSessionIdsAtom)
      ),
    }));
  }
);

export const upsertSessionMetaInStateAtom = atom(
  null,
  (get, set, params: { session: Session; workspaceId?: string }) => {
    const targetWorkspaceId = params.workspaceId ?? get(currentWorkspaceIdAtom);

    set(workspaceSessionsAtom, (current) => ({
      ...current,
      [targetWorkspaceId]: upsertSession(
        current[targetWorkspaceId] ?? [],
        params.session,
        get(pinnedSessionIdsAtom)
      ),
    }));
  }
);

/**
 * 加载指定工作区的会话列表
 */
export const loadSessionsAtom = atom(
  null,
  async (get, set, workspaceId?: string) => {
    const targetWorkspaceId = workspaceId ?? get(currentWorkspaceIdAtom);
    const requestId = getNextSessionLoadRequestId(targetWorkspaceId);
    const cachedBeforeLoad = get(workspaceSessionsAtom)[targetWorkspaceId];
    const sessions = await window.zora.listSessions(targetWorkspaceId);

    if (
      sessionLoadRequestIds.get(targetWorkspaceId) !== requestId ||
      get(workspaceSessionsAtom)[targetWorkspaceId] !== cachedBeforeLoad
    ) {
      return get(workspaceSessionsAtom)[targetWorkspaceId] ?? [];
    }

    const sortedSessions = setWorkspaceSessions(
      set,
      targetWorkspaceId,
      sessions,
      get(pinnedSessionIdsAtom)
    );

    return sortedSessions;
  }
);

/**
 * 启动时加载工作区列表，并恢复当前工作区
 */
export const loadWorkspacesAtom = atom(null, async (get, set) => {
  const rawWorkspaces = await window.zora.listWorkspaces();
  const pinnedWorkspaceIds = prunePinnedWorkspaceIds(
    get(pinnedWorkspaceIdsAtom),
    rawWorkspaces
  );
  persistPinnedWorkspaceIds(pinnedWorkspaceIds);
  set(pinnedWorkspaceIdsAtom, pinnedWorkspaceIds);

  const workspaces = sortWorkspaces(rawWorkspaces, pinnedWorkspaceIds);
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

  const sessionEntries = await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        return {
          workspaceId: workspace.id,
          sessions: await window.zora.listSessions(workspace.id),
          loaded: true,
        } as const;
      } catch (error) {
        console.error(
          `[workspace] Failed to load sessions for workspace ${workspace.id}:`,
          error
        );
        return {
          workspaceId: workspace.id,
          sessions: get(workspaceSessionsAtom)[workspace.id] ?? [],
          loaded: false,
        } as const;
      }
    })
  );
  const allSessionLoadsSucceeded = sessionEntries.every((entry) => entry.loaded);
  const loadedWorkspaceSessions = Object.fromEntries(
    sessionEntries
      .filter((entry) => entry.loaded)
      .map((entry) => [entry.workspaceId, entry.sessions])
  );
  const pinnedSessionIds = allSessionLoadsSucceeded
    ? prunePinnedSessionIds(get(pinnedSessionIdsAtom), loadedWorkspaceSessions)
    : get(pinnedSessionIdsAtom);

  if (allSessionLoadsSucceeded) {
    persistPinnedSessionIds(pinnedSessionIds);
    set(pinnedSessionIdsAtom, pinnedSessionIds);
  }

  const nextWorkspaceSessions = { ...get(workspaceSessionsAtom) };
  for (const entry of sessionEntries) {
    if (!entry.loaded) {
      continue;
    }

    nextWorkspaceSessions[entry.workspaceId] = sortSessions(
      entry.sessions,
      pinnedSessionIds
    );
  }

  set(workspaceSessionsAtom, nextWorkspaceSessions);
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
    get,
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

    set(workspacesAtom, (current) =>
      sortWorkspaces([...current, workspace], get(pinnedWorkspaceIdsAtom))
    );
    set(currentWorkspaceIdAtom, workspace.id);
    persistCurrentWorkspaceId(workspace.id);
    resetWorkspaceSurface(set);
    set(workspaceSessionsAtom, (current) => ({
      ...current,
      [workspace.id]: [],
    }));

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

    const pinnedWorkspaceIds = new Set(get(pinnedWorkspaceIdsAtom));
    pinnedWorkspaceIds.delete(workspaceId);
    persistPinnedWorkspaceIds(pinnedWorkspaceIds);
    set(pinnedWorkspaceIdsAtom, pinnedWorkspaceIds);

    const remaining = sortWorkspaces(
      get(workspacesAtom).filter((workspace) => workspace.id !== workspaceId),
      pinnedWorkspaceIds
    );
    set(workspacesAtom, remaining);
    set(workspaceSessionsAtom, (current) => {
      if (!(workspaceId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[workspaceId];
      return next;
    });

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
 * 操作：切换工作区置顶状态。默认工作区固定第一，不参与置顶。
 */
export const togglePinWorkspaceAtom = atom(
  null,
  (get, set, workspaceId: string) => {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      return;
    }

    const pinnedWorkspaceIds = new Set(get(pinnedWorkspaceIdsAtom));
    if (pinnedWorkspaceIds.has(workspaceId)) {
      pinnedWorkspaceIds.delete(workspaceId);
    } else {
      pinnedWorkspaceIds.add(workspaceId);
    }

    persistPinnedWorkspaceIds(pinnedWorkspaceIds);
    set(pinnedWorkspaceIdsAtom, pinnedWorkspaceIds);
    set(workspacesAtom, (current) => sortWorkspaces(current, pinnedWorkspaceIds));
  }
);

/**
 * 操作：重命名工作区
 */
export const renameWorkspaceAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      workspaceId: string;
      name: string;
    }
  ) => {
    const nextName = params.name.trim();
    if (!nextName) {
      return;
    }

    const previousWorkspace = get(workspacesAtom).find(
      (workspace) => workspace.id === params.workspaceId
    );
    const pinnedWorkspaceIds = get(pinnedWorkspaceIdsAtom);
    const now = new Date().toISOString();

    set(workspacesAtom, (current) =>
      sortWorkspaces(
        current.map((workspace) =>
          workspace.id === params.workspaceId
            ? { ...workspace, name: nextName, updatedAt: now }
            : workspace
        ),
        pinnedWorkspaceIds
      )
    );

    try {
      const renamed = await window.zora.renameWorkspace(
        params.workspaceId,
        nextName
      );
      set(workspacesAtom, (current) =>
        sortWorkspaces(
          current.map((workspace) =>
            workspace.id === renamed.id ? renamed : workspace
          ),
          get(pinnedWorkspaceIdsAtom)
        )
      );
    } catch (error) {
      if (previousWorkspace) {
        set(workspacesAtom, (current) =>
          sortWorkspaces(
            current.map((workspace) =>
              workspace.id === previousWorkspace.id ? previousWorkspace : workspace
            ),
            get(pinnedWorkspaceIdsAtom)
          )
        );
      }
      throw error;
    }
  }
);

/**
 * 操作：进入新对话状态（不创建会话）
 * 保留已有会话消息缓存，只清空当前草稿视图
 */
export const startNewChatAtom = atom(null, (_get, set) => {
  set(currentSessionIdAtom, null);
  set(messagesAtom, []);
  set(draftSelectedProviderIdAtom, undefined);
  set(draftSelectedModelIdAtom, undefined);
  set(draftReasoningLevelAtom, "high");
});

export const startNewChatInWorkspaceAtom = atom(
  null,
  async (get, set, workspaceId: string) => {
    if (workspaceId !== get(currentWorkspaceIdAtom)) {
      await set(switchWorkspaceAtom, workspaceId);
    }

    set(startNewChatAtom);
  }
);

/**
 * 操作：创建新会话
 */
export const createSessionAtom = atom(
  null,
  async (get, set, title: string = "新会话") => {
    const workspaceId = get(currentWorkspaceIdAtom);
    const previousSessionId = get(currentSessionIdAtom);
    const meta = await window.zora.createSession(
      title,
      workspaceId,
      get(draftPermissionModeAtom)
    );

    if (get(currentWorkspaceIdAtom) !== workspaceId) {
      set(workspaceSessionsAtom, (current) => ({
        ...current,
        [workspaceId]: upsertSession(
          current[workspaceId] ?? [],
          meta,
          get(pinnedSessionIdsAtom)
        ),
      }));
      return meta.id;
    }

    set(workspaceSessionsAtom, (current) => ({
      ...current,
      [workspaceId]: upsertSession(
        current[workspaceId] ?? [],
        meta,
        get(pinnedSessionIdsAtom)
      ),
    }));
    if (previousSessionId === null) {
      set(clearDraftStateForSessionAtom, draftKeyForWorkspace(workspaceId));
    }
    set(currentSessionIdAtom, meta.id);
    return meta.id;
  }
);

/**
 * 操作：Fork 当前完整会话
 */
export const forkSessionAtom = atom(
  null,
  async (
    get,
    set,
    input: {
      sourceSessionId: string;
      workspaceId?: string;
      upToMessageId?: string;
    }
  ) => {
    const targetWorkspaceId = input.workspaceId ?? get(currentWorkspaceIdAtom);
    const result = await window.zora.forkSession({
      sourceSessionId: input.sourceSessionId,
      workspaceId: targetWorkspaceId,
      upToMessageId: input.upToMessageId,
    });

    const currentWorkspaceSessions =
      get(workspaceSessionsAtom)[targetWorkspaceId] ?? [];
    const nextSessions = upsertSession(
      currentWorkspaceSessions,
      result.session,
      get(pinnedSessionIdsAtom)
    );
    set(workspaceSessionsAtom, (current) => ({
      ...current,
      [targetWorkspaceId]: nextSessions,
    }));

    if (get(currentWorkspaceIdAtom) !== targetWorkspaceId) {
      set(currentWorkspaceIdAtom, targetWorkspaceId);
      persistCurrentWorkspaceId(targetWorkspaceId);
      resetWorkspaceSurface(set);
    }

    set(setSessionMessagesAtom, result.session.id, result.messages);
    set(currentSessionIdAtom, result.session.id);
    set(draftSelectedProviderIdAtom, undefined);
    set(draftSelectedModelIdAtom, undefined);
    set(draftReasoningLevelAtom, "high");
    set(clearDraftStateForSessionAtom, result.session.id);
    set(clearDraftStateForSessionAtom, draftKeyForWorkspace(targetWorkspaceId));

    return result.session.id;
  }
);

/**
 * 操作：切换到指定工作区内的会话
 */
export const switchWorkspaceSessionAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      workspaceId: string;
      sessionId: string;
    }
  ) => {
    const targetWorkspaceId = params.workspaceId;

    if (targetWorkspaceId !== get(currentWorkspaceIdAtom)) {
      set(currentWorkspaceIdAtom, targetWorkspaceId);
      persistCurrentWorkspaceId(targetWorkspaceId);
      resetWorkspaceSurface(set);

      const cachedSessions = get(workspaceSessionsAtom)[targetWorkspaceId];
      if (cachedSessions) {
        void set(loadSessionsAtom, targetWorkspaceId).catch((error) => {
          console.error(
            `[workspace] Failed to refresh sessions for workspace ${targetWorkspaceId}:`,
            error
          );
        });
      } else {
        await set(loadSessionsAtom, targetWorkspaceId);
      }
    }

    set(currentSessionIdAtom, params.sessionId);

    const cachedMessages = get(sessionMessagesAtom)[params.sessionId];
    if (cachedMessages === undefined) {
      const messages = await window.zora.loadMessages(
        params.sessionId,
        targetWorkspaceId
      );
      if (get(sessionMessagesAtom)[params.sessionId] === undefined) {
        set(setSessionMessagesAtom, params.sessionId, messages);
      }
    }
  }
);

/**
 * 操作：切换会话
 */
export const switchSessionAtom = atom(
  null,
  async (get, set, sessionId: string) => {
    await set(switchWorkspaceSessionAtom, {
      workspaceId: get(currentWorkspaceIdAtom),
      sessionId,
    });
  }
);

/**
 * 操作：归档会话
 */
export const archiveSessionAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      sessionId: string;
      workspaceId?: string;
      scope: "session" | "family";
    }
  ) => {
    const targetWorkspaceId = params.workspaceId ?? get(currentWorkspaceIdAtom);
    const sessionsBeforeArchive =
      get(workspaceSessionsAtom)[targetWorkspaceId] ?? [];
    const target = sessionsBeforeArchive.find(
      (session) => session.id === params.sessionId
    );
    const rootSessionId = target?.parentSessionId ?? target?.id;
    const removedSessionIds = new Set(
      target?.parentSessionId && params.scope === "session"
        ? [target.id]
        : sessionsBeforeArchive
            .filter(
              (session) =>
                session.id === rootSessionId ||
                session.parentSessionId === rootSessionId
            )
            .map((session) => session.id)
    );
    const archived = await window.zora.archiveSession(
      params.sessionId,
      targetWorkspaceId,
      params.scope
    );

    if (!archived) {
      throw new Error("Session not found.");
    }

    for (const removedSessionId of removedSessionIds) {
      removeSessionFromClientState(
        get,
        set,
        removedSessionId,
        targetWorkspaceId
      );
    }
    emitArchivedSessionsChanged();
    return archived;
  }
);

/**
 * 操作：恢复归档会话
 */
export const restoreSessionAtom = atom(
  null,
  async (
    get,
    set,
    params: { sessionId: string; workspaceId?: string }
  ) => {
    const targetWorkspaceId = params.workspaceId ?? get(currentWorkspaceIdAtom);
    const restored = await window.zora.restoreSession(
      params.sessionId,
      targetWorkspaceId
    );

    if (!restored) {
      return null;
    }

    await set(loadSessionsAtom, targetWorkspaceId);
    emitArchivedSessionsChanged();

    return restored;
  }
);

/**
 * 操作：删除会话
 */
export const deleteSessionAtom = atom(
  null,
  async (get, set, sessionId: string, workspaceId?: string) => {
    const targetWorkspaceId = workspaceId ?? get(currentWorkspaceIdAtom);
    const wasCurrentSession =
      get(currentWorkspaceIdAtom) === targetWorkspaceId &&
      get(currentSessionIdAtom) === sessionId;
    const wasPinned = get(pinnedSessionIdsAtom).has(sessionId);

    try {
      await window.zora.deleteSession(sessionId, targetWorkspaceId);
      removeSessionFromClientState(get, set, sessionId, targetWorkspaceId);
      logSessionStateSynced({
        action: "delete",
        sessionId,
        workspaceId: targetWorkspaceId,
        wasCurrentSession,
        wasPinned,
      });
    } catch (error) {
      logSessionStateSyncError({
        action: "delete",
        sessionId,
        workspaceId: targetWorkspaceId,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }
);

/**
 * 操作：更新会话活跃时间（让它浮到同组顶部）
 */
export const touchSessionAtom = atom(null, (get, set, sessionId: string, workspaceId?: string) => {
  const now = new Date().toISOString();
  const targetWorkspaceId = workspaceId ?? get(currentWorkspaceIdAtom);

  set(workspaceSessionsAtom, (current) => ({
    ...current,
    [targetWorkspaceId]: updateSession(
      current[targetWorkspaceId] ?? [],
      sessionId,
      { updatedAt: now },
      get(pinnedSessionIdsAtom)
    ),
  }));
});

/**
 * 操作：重命名会话
 */
export const renameSessionAtom = atom(
  null,
  (get, set, params: { sessionId: string; title: string; workspaceId?: string }) => {
    const targetWorkspaceId = params.workspaceId ?? get(currentWorkspaceIdAtom);
    const nextTitle = params.title.trim();

    if (!nextTitle) {
      return;
    }

    const updates = {
      title: nextTitle,
      updatedAt: new Date().toISOString(),
    };

    set(workspaceSessionsAtom, (current) => ({
      ...current,
      [targetWorkspaceId]: updateSession(
        current[targetWorkspaceId] ?? [],
        params.sessionId,
        updates,
        get(pinnedSessionIdsAtom)
      ),
    }));

    window.zora
      .renameSession(params.sessionId, nextTitle, targetWorkspaceId)
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

    persistPinnedSessionIds(nextPinnedIds);
    set(pinnedSessionIdsAtom, nextPinnedIds);
    set(workspaceSessionsAtom, (current) => {
      for (const [workspaceId, sessions] of Object.entries(current)) {
        if (!sessions.some((session) => session.id === sessionId)) {
          continue;
        }

        return {
          ...current,
          [workspaceId]: sortSessions(sessions, nextPinnedIds),
        };
      }

      return current;
    });
  }
);
