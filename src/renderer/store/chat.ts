import { atom, type Getter } from "jotai";
import type {
  AssistantTurn,
  ConversationMessage,
  FileAttachment,
  ProcessStep,
} from "../types";
import type { AgentRunSource } from "../../shared/zora";
import { createId, stringifyUnknown } from "../utils/message";
import { currentSessionIdAtom } from "./workspace";
import { appPhaseAtom } from "./zora";

// 基础状态 atoms
export const isAgentIdleAtom = atom(false);
type SessionMessages = Record<string, ConversationMessage[]>;
type SessionDrafts = Record<string, string>;
type SessionDraftAttachments = Record<string, FileAttachment[]>;
type MessageUpdate =
  | ConversationMessage[]
  | ((current: ConversationMessage[]) => ConversationMessage[]);

const EMPTY_DRAFT = "";
const EMPTY_ATTACHMENTS: FileAttachment[] = [];

function resolveActiveSessionKey(get: Getter): string {
  if (get(appPhaseAtom).startsWith("awakening")) {
    return "__awakening__";
  }

  return get(currentSessionIdAtom) ?? "__draft__";
}

function applyScopedValueUpdate<T>(
  current: Record<string, T>,
  sessionId: string,
  update: T | ((currentValue: T) => T),
  fallbackValue: T,
  isEmpty: (value: T) => boolean
): Record<string, T> {
  const previous = current[sessionId] ?? fallbackValue;
  const next =
    typeof update === "function"
      ? (update as (currentValue: T) => T)(previous)
      : update;

  if (Object.is(next, previous)) {
    return current;
  }

  if (isEmpty(next)) {
    if (!(sessionId in current)) {
      return current;
    }

    const trimmed = { ...current };
    delete trimmed[sessionId];
    return trimmed;
  }

  return {
    ...current,
    [sessionId]: next,
  };
}

function removeScopedValue<T>(current: Record<string, T>, sessionId: string): Record<string, T> {
  if (!(sessionId in current)) {
    return current;
  }

  const next = { ...current };
  delete next[sessionId];
  return next;
}

export const sessionDraftsAtom = atom<SessionDrafts>({});
export const sessionDraftAttachmentsAtom = atom<SessionDraftAttachments>({});

export const draftAtom = atom(
  (get) => {
    const sessionId = resolveActiveSessionKey(get);
    return get(sessionDraftsAtom)[sessionId] ?? EMPTY_DRAFT;
  },
  (get, set, update: string) => {
    const sessionId = resolveActiveSessionKey(get);
    set(sessionDraftsAtom, (current) =>
      applyScopedValueUpdate(current, sessionId, update, EMPTY_DRAFT, (value) => value.length === 0)
    );
  }
);

export const draftAttachmentsAtom = atom((get) => {
  const sessionId = resolveActiveSessionKey(get);
  return get(sessionDraftAttachmentsAtom)[sessionId] ?? EMPTY_ATTACHMENTS;
});

export const addDraftAttachmentsAtom = atom(
  null,
  (get, set, newAttachments: FileAttachment[]) => {
    const current = get(draftAttachmentsAtom);
    const remaining = 5 - current.length;

    if (remaining <= 0) {
      return;
    }

    const toAdd = newAttachments
      .filter(
        (newAttachment) =>
          !current.some(
            (attachment) =>
              attachment.name === newAttachment.name &&
              attachment.size === newAttachment.size
          )
      )
      .slice(0, remaining);

    if (toAdd.length === 0) {
      return;
    }

    const sessionId = resolveActiveSessionKey(get);
    set(sessionDraftAttachmentsAtom, (drafts) =>
      applyScopedValueUpdate(
        drafts,
        sessionId,
        [...current, ...toAdd],
        EMPTY_ATTACHMENTS,
        (value) => value.length === 0
      )
    );
  }
);

export const removeDraftAttachmentAtom = atom(
  null,
  (get, set, attachmentId: string) => {
    const sessionId = resolveActiveSessionKey(get);
    const nextAttachments = get(draftAttachmentsAtom).filter(
      (attachment) => attachment.id !== attachmentId
    );
    set(sessionDraftAttachmentsAtom, (drafts) =>
      applyScopedValueUpdate(
        drafts,
        sessionId,
        nextAttachments,
        EMPTY_ATTACHMENTS,
        (value) => value.length === 0
      )
    );
  }
);

export const clearDraftAttachmentsAtom = atom(null, (get, set) => {
  const sessionId = resolveActiveSessionKey(get);
  set(sessionDraftAttachmentsAtom, (current) =>
    removeScopedValue(current, sessionId)
  );
});

function applyMessageUpdate(
  current: SessionMessages,
  sessionId: string,
  update: MessageUpdate
): SessionMessages {
  const previous = current[sessionId] ?? [];
  const next =
    typeof update === "function"
      ? (update as (messages: ConversationMessage[]) => ConversationMessage[])(previous)
      : update;

  if (next === previous) {
    return current;
  }

  return {
    ...current,
    [sessionId]: next
  };
}

function removeSessionMessages(
  current: SessionMessages,
  sessionId: string
): SessionMessages {
  if (!(sessionId in current)) {
    return current;
  }

  const next = { ...current };
  delete next[sessionId];
  return next;
}

export const sessionMessagesAtom = atom<SessionMessages>({});

export const messagesAtom = atom(
  (get) => {
    const sessionId = resolveActiveSessionKey(get);
    return get(sessionMessagesAtom)[sessionId] ?? [];
  },
  (get, set, update: MessageUpdate) => {
    const sessionId = resolveActiveSessionKey(get);
    set(sessionMessagesAtom, (current) => applyMessageUpdate(current, sessionId, update));
  }
);

export const setSessionMessagesAtom = atom(
  null,
  (_get, set, sessionId: string, update: MessageUpdate) => {
    set(sessionMessagesAtom, (current) => applyMessageUpdate(current, sessionId, update));
  }
);

export const clearSessionMessagesAtom = atom(
  null,
  (_get, set, sessionId: string) => {
    set(sessionMessagesAtom, (current) => removeSessionMessages(current, sessionId));
  }
);

export const clearDraftStateForSessionAtom = atom(
  null,
  (_get, set, sessionId: string) => {
    set(sessionDraftsAtom, (current) => removeScopedValue(current, sessionId));
    set(sessionDraftAttachmentsAtom, (current) =>
      removeScopedValue(current, sessionId)
    );
  }
);

/**
 * 正在运行 Agent 的会话 ID 集合
 */
export const runningSessionsAtom = atom(new Set<string>());
export const runningSessionSourcesAtom = atom<Record<string, AgentRunSource>>({});

/**
 * 派生：当前会话是否正在运行
 * 没有当前会话时，回退到 awakening 会话，兼容唤醒阶段 UI。
 */
export const isCurrentSessionRunningAtom = atom((get) => {
  const currentId = get(currentSessionIdAtom);
  if (currentId) {
    return get(runningSessionsAtom).has(currentId);
  }

  return get(runningSessionsAtom).has("__awakening__");
});

export const currentSessionRunSourceAtom = atom<AgentRunSource | undefined>((get) => {
  const currentId = get(currentSessionIdAtom);
  const targetSessionId = currentId ?? "__awakening__";
  return get(runningSessionSourcesAtom)[targetSessionId];
});

/**
 * 操作：设置指定会话的运行状态
 */
export const setSessionRunningAtom = atom<null, [string, boolean, AgentRunSource?], void>(
  null,
  (get, set, sessionId: string, isRunning: boolean, source?: AgentRunSource) => {
    set(runningSessionsAtom, (current) => {
      const next = new Set(current);
      if (isRunning) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });

    set(runningSessionSourcesAtom, (current) => {
      if (!isRunning) {
        if (!(sessionId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[sessionId];
        return next;
      }

      const nextSource = source ?? current[sessionId] ?? "desktop";
      if (current[sessionId] === nextSource) {
        return current;
      }

      return {
        ...current,
        [sessionId]: nextSource,
      };
    });
  }
);

export const isRunningAtom = isCurrentSessionRunningAtom;

function createAssistantTurnMessage(now = Date.now()): ConversationMessage {
  const turnId = createId("turn");
  return {
    id: turnId,
    role: "assistant",
    timestamp: now,
    turn: {
      id: turnId,
      processSteps: [],
      bodySegments: [],
      status: "streaming",
      startedAt: now,
    },
  };
}

function isAssistantTurnMessage(
  message: ConversationMessage
): message is ConversationMessage & { role: "assistant"; turn: AssistantTurn } {
  return message.role === "assistant" && Boolean(message.turn);
}

function getActiveTurn(messages: ConversationMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistantTurnMessage(message) && message.turn.status === "streaming") {
      return message;
    }
  }

  return null;
}

function updateActiveTurn(
  messages: ConversationMessage[],
  updater: (turn: AssistantTurn) => AssistantTurn
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantTurnMessage(message) || message.turn.status !== "streaming") {
      continue;
    }

    const nextTurn = updater(message.turn);
    if (nextTurn === message.turn) {
      return messages;
    }

    const nextMessages = [...messages];
    nextMessages[index] = {
      ...message,
      turn: nextTurn,
    };
    return nextMessages;
  }

  return messages;
}

function ensureActiveTurn(messages: ConversationMessage[]) {
  return getActiveTurn(messages) ? messages : [...messages, createAssistantTurnMessage()];
}

function updateOrCreateActiveTurn(
  messages: ConversationMessage[],
  updater: (turn: AssistantTurn) => AssistantTurn
) {
  return updateActiveTurn(ensureActiveTurn(messages), updater);
}

function updateLastAssistantTurn(
  messages: ConversationMessage[],
  predicate: (turn: AssistantTurn) => boolean,
  updater: (turn: AssistantTurn) => AssistantTurn
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantTurnMessage(message) || !predicate(message.turn)) {
      continue;
    }

    const nextTurn = updater(message.turn);
    if (nextTurn === message.turn) {
      return messages;
    }

    const nextMessages = [...messages];
    nextMessages[index] = {
      ...message,
      turn: nextTurn,
    };
    return nextMessages;
  }

  return messages;
}

function findLastPendingThinkingStepIndex(turn: AssistantTurn) {
  return turn.processSteps.findLastIndex(
    (step) => step.type === "thinking" && step.thinking.completedAt === undefined
  );
}

function findLastRunningToolStepIndex(turn: AssistantTurn) {
  return turn.processSteps.findLastIndex(
    (step) => step.type === "tool" && step.tool.status === "running"
  );
}

function completePendingThinkingSteps(turn: AssistantTurn, completedAt: number) {
  let changed = false;
  const processSteps = turn.processSteps.map<ProcessStep>((step) => {
    if (step.type !== "thinking" || step.thinking.completedAt !== undefined) {
      return step;
    }

    changed = true;
    return {
      type: "thinking",
      thinking: {
        ...step.thinking,
        completedAt,
      },
    };
  });

  return changed
    ? {
        ...turn,
        processSteps,
      }
    : turn;
}

function failRunningTools(turn: AssistantTurn, completedAt: number, fallbackResult: string) {
  let changed = false;
  const processSteps = turn.processSteps.map<ProcessStep>((step) => {
    if (step.type !== "tool" || step.tool.status !== "running") {
      return step;
    }

    changed = true;
    return {
      type: "tool",
      tool: {
        ...step.tool,
        status: "error",
        result: step.tool.result || fallbackResult,
        completedAt: step.tool.completedAt ?? completedAt,
      },
    };
  });

  return changed
    ? {
        ...turn,
        processSteps,
      }
    : turn;
}

export const createAssistantTurnAtom = atom<null, [string], void>(
  null,
  (_get, set, sessionId: string) => {
    set(setSessionMessagesAtom, sessionId, (current) => [
      ...current,
      createAssistantTurnMessage(),
    ]);
  }
);

export const ensureActiveTurnAtom = atom<null, [string], void>(
  null,
  (_get, set, sessionId: string) => {
    set(setSessionMessagesAtom, sessionId, (current) => ensureActiveTurn(current));
  }
);

export const startBodySegmentAtom = atom<null, [string, string?], void>(
  null,
  (_get, set, sessionId: string, initialText = "") => {
    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => {
        const lastSegment = turn.bodySegments[turn.bodySegments.length - 1];
        if (lastSegment && lastSegment.text.length === 0 && initialText.length === 0) {
          return turn;
        }

        return {
          ...turn,
          bodySegments: [
            ...turn.bodySegments,
            {
              id: createId("segment"),
              text: initialText,
            },
          ],
        };
      })
    );
  }
);

export const appendBodyTextAtom = atom<null, [string, string], void>(
  null,
  (_get, set, sessionId: string, chunk: string) => {
    if (chunk.length === 0) {
      return;
    }

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => {
        if (turn.bodySegments.length === 0) {
          return {
            ...turn,
            bodySegments: [
              {
                id: createId("segment"),
                text: chunk,
              },
            ],
          };
        }

        const lastIndex = turn.bodySegments.length - 1;
        const lastSegment = turn.bodySegments[lastIndex];
        const updatedSegment = {
          ...lastSegment,
          text: `${lastSegment.text}${chunk}`,
        };

        if (turn.bodySegments.length === 1) {
          return {
            ...turn,
            bodySegments: [updatedSegment],
          };
        }

        const bodySegments = turn.bodySegments.slice(0, lastIndex);
        bodySegments.push(updatedSegment);

        return {
          ...turn,
          bodySegments,
        };
      })
    );
  }
);

export const addThinkingStepAtom = atom<null, [string, string?], void>(
  null,
  (_get, set, sessionId: string, initialContent = "") => {
    const startedAt = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => ({
        ...turn,
        processSteps: [
          ...turn.processSteps,
          {
            type: "thinking",
            thinking: {
              id: createId("thinking"),
              content: initialContent,
              startedAt,
            },
          },
        ],
      }))
    );
  }
);

export const appendThinkingAtom = atom<null, [string, string], void>(
  null,
  (_get, set, sessionId: string, chunk: string) => {
    if (chunk.length === 0) {
      return;
    }

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => {
        const targetIndex = findLastPendingThinkingStepIndex(turn);

        if (targetIndex === -1) {
          return {
            ...turn,
            processSteps: [
              ...turn.processSteps,
              {
                type: "thinking",
                thinking: {
                  id: createId("thinking"),
                  content: chunk,
                  startedAt: Date.now(),
                },
              },
            ],
          };
        }

        return {
          ...turn,
          processSteps: turn.processSteps.map<ProcessStep>((step, index) =>
            index === targetIndex && step.type === "thinking"
              ? {
                  type: "thinking",
                  thinking: {
                    ...step.thinking,
                    content: `${step.thinking.content}${chunk}`,
                  },
                }
              : step
          ),
        };
      })
    );
  }
);

export const completeThinkingStepAtom = atom<null, [string], void>(
  null,
  (_get, set, sessionId: string) => {
    const completedAt = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateActiveTurn(current, (turn) => {
        const targetIndex = findLastPendingThinkingStepIndex(turn);
        if (targetIndex === -1) {
          return turn;
        }

        return {
          ...turn,
          processSteps: turn.processSteps.map<ProcessStep>((step, index) =>
            index === targetIndex && step.type === "thinking"
              ? {
                  type: "thinking",
                  thinking: {
                    ...step.thinking,
                    completedAt,
                  },
                }
              : step
          ),
        };
      })
    );
  }
);

export const addToolStepAtom = atom<null, [string, string, string, string?], void>(
  null,
  (_get, set, sessionId: string, toolName: string, toolUseId: string, input = "") => {
    if (!toolName || !toolUseId) {
      return;
    }

    const startedAt = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => ({
        ...turn,
        processSteps: [
          ...turn.processSteps,
          {
            type: "tool",
            tool: {
              id: toolUseId,
              name: toolName,
              input,
              status: "running",
              startedAt,
            },
          },
        ],
      }))
    );
  }
);

export const appendToolInputAtom = atom<null, [string, string], void>(
  null,
  (_get, set, sessionId: string, chunk: string) => {
    if (chunk.length === 0) {
      return;
    }

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateActiveTurn(current, (turn) => {
        const targetIndex = findLastRunningToolStepIndex(turn);
        if (targetIndex === -1) {
          return turn;
        }

        return {
          ...turn,
          processSteps: turn.processSteps.map<ProcessStep>((step, index) =>
            index === targetIndex && step.type === "tool"
              ? {
                  type: "tool",
                  tool: {
                    ...step.tool,
                    input: `${step.tool.input}${chunk}`,
                  },
                }
              : step
          ),
        };
      })
    );
  }
);

export const completeToolResultAtom = atom<null, [string, string, unknown, boolean?], void>(
  null,
  (_get, set, sessionId: string, toolUseId: string, content: unknown, isError = false) => {
    if (!toolUseId) {
      return;
    }

    const completedAt = Date.now();
    const result = stringifyUnknown(content);

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateLastAssistantTurn(
        current,
        (turn) =>
          turn.processSteps.some(
            (step) => step.type === "tool" && step.tool.id === toolUseId
          ),
        (turn) => ({
          ...turn,
          processSteps: turn.processSteps.map<ProcessStep>((step) =>
            step.type === "tool" && step.tool.id === toolUseId
              ? {
                  type: "tool",
                  tool: {
                    ...step.tool,
                    result,
                    status: isError ? "error" : "done",
                    completedAt,
                  },
                }
              : step
          ),
        })
      )
    );
  }
);

export const completeStreamingBlockAtom = atom<null, [string], void>(
  null,
  (_get, set, sessionId: string) => {
    set(setSessionMessagesAtom, sessionId, (current) => current);
  }
);

export const completeTurnAtom = atom<null, [string, "done" | "stopped"], void>(
  null,
  (_get, set, sessionId: string, status: "done" | "stopped") => {
    const completedAt = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateLastAssistantTurn(
        current,
        (turn) => turn.status === "streaming",
        (turn) => {
          let nextTurn = completePendingThinkingSteps(turn, completedAt);

          if (status === "stopped") {
            nextTurn = failRunningTools(
              nextTurn,
              completedAt,
              "Tool execution stopped before returning a result."
            );
          }

          return {
            ...nextTurn,
            status,
            completedAt: nextTurn.completedAt ?? completedAt,
          };
        }
      )
    );
  }
);

export const failTurnAtom = atom<null, [string, string], void>(
  null,
  (_get, set, sessionId: string, errorMessage: string) => {
    const completedAt = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) => {
      const updated = updateLastAssistantTurn(
        current,
        (turn) => turn.status === "streaming",
        (turn) => {
          const withThinkingCompleted = completePendingThinkingSteps(turn, completedAt);
          const withFailedTools = failRunningTools(
            withThinkingCompleted,
            completedAt,
            "Tool execution stopped before returning a result."
          );

          return {
            ...withFailedTools,
            status: "error",
            error: errorMessage,
            completedAt: withFailedTools.completedAt ?? completedAt,
          };
        }
      );

      if (updated !== current) {
        return updated;
      }

      const turnId = createId("turn");
      return [
        ...current,
        {
          id: turnId,
          role: "assistant",
          timestamp: completedAt,
          turn: {
            id: turnId,
            processSteps: [],
            bodySegments: [],
            status: "error",
            error: errorMessage || "The agent could not start.",
            startedAt: completedAt,
            completedAt,
          },
        },
      ];
    });
  }
);

/**
 * 开始新对话
 * 只创建用户消息，助手 turn 由流式事件驱动
 */
export const startConversationAtom = atom<null, [string, FileAttachment[]?], void>(
  null,
  (
    _get,
    set,
    prompt: string,
    attachments: FileAttachment[] = []
  ) => {
    const timestamp = Date.now();

    set(messagesAtom, (current) => [
      ...current,
      {
        id: createId("user"),
        role: "user",
        text: prompt.length > 0 ? prompt : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp,
      },
    ]);
  }
);
