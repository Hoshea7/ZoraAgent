import { atom, type Getter } from "jotai";
import type {
  PermissionRequest,
  AskUserQuestionRequest,
  PermissionMode,
} from "../../shared/zora";
import { currentSessionIdAtom } from "./workspace";
import { DRAFT_SESSION_ID } from "./session-constants";

type SessionId = string;
type SessionScopedQueues<T> = Record<SessionId, T[]>;
type SessionScopedPermissionRequest = PermissionRequest & { sessionId: SessionId };
type SessionScopedAskUserQuestionRequest = AskUserQuestionRequest & { sessionId: SessionId };

function resolveActiveHitlSessionId(get: Getter): SessionId {
  return get(currentSessionIdAtom) ?? DRAFT_SESSION_ID;
}

function appendSessionScopedRequest<T extends { sessionId: SessionId }>(
  current: SessionScopedQueues<T>,
  request: T
): SessionScopedQueues<T> {
  return {
    ...current,
    [request.sessionId]: [...(current[request.sessionId] ?? []), request],
  };
}

function removeRequestById<T extends { requestId: string }>(
  current: SessionScopedQueues<T>,
  requestId: string
): SessionScopedQueues<T> {
  let changed = false;
  const next: SessionScopedQueues<T> = {};

  for (const [sessionId, requests] of Object.entries(current)) {
    const filtered = requests.filter((request) => request.requestId !== requestId);
    if (filtered.length !== requests.length) {
      changed = true;
    }
    if (filtered.length > 0) {
      next[sessionId] = filtered;
    }
  }

  return changed ? next : current;
}

function clearRequestsForSession<T>(
  current: SessionScopedQueues<T>,
  sessionId: SessionId
): SessionScopedQueues<T> {
  if (!(sessionId in current)) {
    return current;
  }

  const next = { ...current };
  delete next[sessionId];
  return next;
}

// Pending 队列按请求到达顺序展示，避免多个提问同时覆盖当前会话。
export const pendingPermissionsBySessionAtom = atom<
  SessionScopedQueues<SessionScopedPermissionRequest>
>({});
export const pendingAskUserQuestionsBySessionAtom = atom<
  SessionScopedQueues<SessionScopedAskUserQuestionRequest>
>({});

export const pendingPermissionsAtom = atom((get) => {
  const sessionId = resolveActiveHitlSessionId(get);
  return get(pendingPermissionsBySessionAtom)[sessionId] ?? [];
});

export const pendingAskUserQuestionsAtom = atom((get) => {
  const sessionId = resolveActiveHitlSessionId(get);
  return get(pendingAskUserQuestionsBySessionAtom)[sessionId] ?? [];
});

export const hasHitlPendingAtom = atom((get) => {
  return (
    get(pendingPermissionsAtom).length > 0 ||
    get(pendingAskUserQuestionsAtom).length > 0
  );
});

/** 推入一个权限请求 */
export const pushPermissionAtom = atom(
  null,
  (_get, set, payload: { request: PermissionRequest; sessionId: SessionId }) => {
    const request: SessionScopedPermissionRequest = {
      ...payload.request,
      sessionId: payload.sessionId,
    };
    console.log("[renderer][hitl-store] pushPermission.", {
      requestId: request.requestId,
      toolName: request.toolName,
      sessionId: request.sessionId,
    });
    set(pendingPermissionsBySessionAtom, (prev) =>
      appendSessionScopedRequest(prev, request)
    );
  }
);

/** 移除已响应的权限请求 */
export const resolvePermissionAtom = atom(
  null,
  (_get, set, requestId: string) => {
    console.log("[renderer][hitl-store] resolvePermission.", { requestId });
    set(pendingPermissionsBySessionAtom, (prev) =>
      removeRequestById(prev, requestId)
    );
  }
);

/** 推入一个 AskUserQuestion 请求 */
export const pushAskUserQuestionAtom = atom(
  null,
  (
    _get,
    set,
    payload: { request: AskUserQuestionRequest; sessionId: SessionId }
  ) => {
    const request: SessionScopedAskUserQuestionRequest = {
      ...payload.request,
      sessionId: payload.sessionId,
    };
    console.log("[renderer][hitl-store] pushAskUserQuestion.", {
      requestId: request.requestId,
      questionCount: request.questions.length,
      sessionId: request.sessionId,
    });
    set(pendingAskUserQuestionsBySessionAtom, (prev) =>
      appendSessionScopedRequest(prev, request)
    );
  }
);

/** 移除已响应的 AskUserQuestion 请求 */
export const removeAskUserQuestionAtom = atom(
  null,
  (_get, set, requestId: string) => {
    console.log("[renderer][hitl-store] removeAskUserQuestion.", { requestId });
    set(pendingAskUserQuestionsBySessionAtom, (prev) =>
      removeRequestById(prev, requestId)
    );
  }
);

/** 清空某个会话的 pending 请求 */
export const clearHitlForSessionAtom = atom(
  null,
  (_get, set, sessionId: SessionId) => {
    console.log("[renderer][hitl-store] clearPendingForSession.", { sessionId });
    set(pendingPermissionsBySessionAtom, (prev) =>
      clearRequestsForSession(prev, sessionId)
    );
    set(pendingAskUserQuestionsBySessionAtom, (prev) =>
      clearRequestsForSession(prev, sessionId)
    );
  }
);

/** 会话结束时清空所有 pending */
export const clearAllHitlAtom = atom(null, (_get, set) => {
  console.log("[renderer][hitl-store] clearAllPending.");
  set(pendingPermissionsBySessionAtom, {});
  set(pendingAskUserQuestionsBySessionAtom, {});
});

/** 当前会话的 Permission Mode */
export const permissionModeAtom = atom<PermissionMode>("ask");

/** 更新 Permission Mode，并同步到 Main 进程 */
export const setPermissionModeAtom = atom(
  null,
  async (_get, set, mode: PermissionMode) => {
    set(permissionModeAtom, mode);
    await window.zora.setPermissionMode(mode);
  }
);
