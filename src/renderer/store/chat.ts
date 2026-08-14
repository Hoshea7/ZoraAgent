import { atom, type Getter } from "jotai";
import type {
  AssistantTurn,
  ConversationMessage,
  FileAttachment,
  ProcessStep,
} from "../types";
import type { AgentRunSource } from "../../shared/zora";
import { createId, isRecord, stringifyUnknown } from "../utils/message";
import { normalizeThinkingContent } from "../utils/thinking";
import { currentSessionIdAtom, currentWorkspaceIdAtom } from "./workspace";
import { draftKeyForWorkspace } from "./session-constants";

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
  const sessionId = get(currentSessionIdAtom);
  if (sessionId) return sessionId;
  return draftKeyForWorkspace(get(currentWorkspaceIdAtom));
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

export const hasMessagesAtom = atom((get) => get(messagesAtom).length > 0);

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
 */
export const isCurrentSessionRunningAtom = atom((get) => {
  const currentId = get(currentSessionIdAtom);
  return currentId ? get(runningSessionsAtom).has(currentId) : false;
});

export const currentSessionRunSourceAtom = atom<AgentRunSource | undefined>((get) => {
  const currentId = get(currentSessionIdAtom);
  return currentId ? get(runningSessionSourcesAtom)[currentId] : undefined;
});

/**
 * 操作：设置指定会话的运行状态
 */
export const setSessionRunningAtom = atom<null, [string, boolean, AgentRunSource?], void>(
  null,
  (get, set, sessionId: string, isRunning: boolean, source?: AgentRunSource) => {
    set(runningSessionsAtom, (current) => {
      if (current.has(sessionId) === isRunning) {
        return current;
      }

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

function isPendingQueuedUserMessage(message: ConversationMessage) {
  return message.role === "user" && message.queueState === "pending";
}

function getActiveTurn(messages: ConversationMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      if (isPendingQueuedUserMessage(message)) {
        continue;
      }

      return null;
    }

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
    if (message.role === "user") {
      if (isPendingQueuedUserMessage(message)) {
        continue;
      }

      return messages;
    }

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
  if (getActiveTurn(messages)) {
    return messages;
  }

  const activatedQueuedMessages = activatePendingQueuedConversation(messages, Date.now());
  return activatedQueuedMessages !== messages
    ? activatedQueuedMessages
    : [...messages, createAssistantTurnMessage()];
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

function findPendingThinkingStepIndex(turn: AssistantTurn, thinkingId?: string) {
  if (!thinkingId) {
    return findLastPendingThinkingStepIndex(turn);
  }

  return turn.processSteps.findIndex(
    (step) =>
      step.type === "thinking" &&
      step.thinking.id === thinkingId &&
      step.thinking.completedAt === undefined
  );
}

function findLastRunningToolStepIndex(turn: AssistantTurn) {
  return turn.processSteps.findLastIndex(
    (step) => step.type === "tool" && step.tool.status === "running"
  );
}

function findRunningToolStepIndex(turn: AssistantTurn, toolUseId?: string) {
  if (!toolUseId) {
    return findLastRunningToolStepIndex(turn);
  }

  return turn.processSteps.findIndex(
    (step) =>
      step.type === "tool" &&
      step.tool.id === toolUseId &&
      step.tool.status === "running"
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

function activatePendingQueuedConversation(
  messages: ConversationMessage[],
  timestamp: number,
  queueUuid?: string
): ConversationMessage[] {
  let firstPendingIndex = -1;
  let lastPendingIndex = -1;
  let hasMatchingQueueUuid = queueUuid === undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isPendingQueuedUserMessage(message)) {
      firstPendingIndex = index;
      if (lastPendingIndex === -1) {
        lastPendingIndex = index;
      }
      if (queueUuid !== undefined && message.queueUuid === queueUuid) {
        hasMatchingQueueUuid = true;
      }
      continue;
    }

    if (lastPendingIndex !== -1) {
      break;
    }
  }

  if (firstPendingIndex === -1 || lastPendingIndex === -1 || !hasMatchingQueueUuid) {
    return messages;
  }

  const activatedMessages = messages.map((message, index) => {
    if (index < firstPendingIndex && isAssistantTurnMessage(message)) {
      if (message.turn.status !== "streaming") {
        return message;
      }

      const completedTurn = completePendingThinkingSteps(message.turn, timestamp);
      return {
        ...message,
        turn: {
          ...completedTurn,
          status: "done" as const,
          completedAt: completedTurn.completedAt ?? timestamp,
        },
      };
    }

    if (
      index >= firstPendingIndex &&
      index <= lastPendingIndex &&
      isPendingQueuedUserMessage(message)
    ) {
      return {
        ...message,
        queueState: "accepted" as const,
      };
    }

    return message;
  });

  return [...activatedMessages, createAssistantTurnMessage(timestamp)];
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

function getAssistantSnapshotMessage(sdkMessage: unknown): Record<string, unknown> | null {
  if (!isRecord(sdkMessage)) {
    return null;
  }

  if (sdkMessage.type === "assistant" && isRecord(sdkMessage.message)) {
    return sdkMessage.message;
  }

  return sdkMessage;
}

function getAssistantSnapshotUuid(sdkMessage: unknown): string | undefined {
  return isRecord(sdkMessage) && typeof sdkMessage.uuid === "string"
    ? sdkMessage.uuid
    : undefined;
}

function getAssistantSnapshotBlocks(sdkMessage: unknown): Record<string, unknown>[] {
  const message = getAssistantSnapshotMessage(sdkMessage);

  if (!message || !Array.isArray(message.content)) {
    return [];
  }

  return message.content.filter(isRecord);
}

function getSnapshotText(blocks: Record<string, unknown>[]): string {
  return blocks
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function mergeAssistantSnapshotIntoTurn(
  turn: AssistantTurn,
  blocks: Record<string, unknown>[],
  timestamp: number
): AssistantTurn {
  let nextTurn = turn;
  const snapshotText = getSnapshotText(blocks);
  const currentText = turn.bodySegments.map((segment) => segment.text).join("");

  if (snapshotText.length > 0 && snapshotText !== currentText) {
    const lastIndex = nextTurn.bodySegments.length - 1;
    const lastSegment = nextTurn.bodySegments[lastIndex];

    if (!lastSegment) {
      nextTurn = {
        ...nextTurn,
        bodySegments: [{ id: createId("segment"), text: snapshotText }],
      };
    } else if (
      snapshotText !== lastSegment.text &&
      snapshotText.startsWith(lastSegment.text)
    ) {
      nextTurn = {
        ...nextTurn,
        bodySegments: nextTurn.bodySegments.map((segment, index) =>
          index === lastIndex ? { ...segment, text: snapshotText } : segment
        ),
      };
    } else if (!currentText.endsWith(snapshotText)) {
      nextTurn = {
        ...nextTurn,
        bodySegments: [
          ...nextTurn.bodySegments,
          { id: createId("segment"), text: snapshotText },
        ],
      };
    }
  }

  let processSteps = nextTurn.processSteps;

  for (const block of blocks) {
    if (block.type === "thinking" && typeof block.thinking === "string") {
      const thinkingId = typeof block.id === "string" ? block.id : "";
      const normalizedThinking = normalizeThinkingContent(block.thinking);
      const alreadyExists = processSteps.some(
        (step) =>
          step.type === "thinking" &&
          ((thinkingId.length > 0 && step.thinking.id === thinkingId) ||
            normalizeThinkingContent(step.thinking.content) === normalizedThinking)
      );

      if (!alreadyExists) {
        processSteps = [
          ...processSteps,
          {
            type: "thinking",
            thinking: {
              id: thinkingId || createId("thinking"),
              content: normalizedThinking,
              startedAt: timestamp,
              completedAt: timestamp,
            },
          },
        ];
      }
      continue;
    }

    if (block.type !== "tool_use") {
      continue;
    }

    const toolId = typeof block.id === "string" ? block.id : "";
    const toolName = typeof block.name === "string" ? block.name : "unknown";
    if (!toolId) {
      continue;
    }

    const toolInput = stringifyUnknown(block.input);
    let updatedExistingTool = false;
    processSteps = processSteps.map<ProcessStep>((step) => {
      if (step.type !== "tool" || step.tool.id !== toolId) {
        return step;
      }

      updatedExistingTool = true;
      if (toolInput.length === 0 || step.tool.input === toolInput) {
        return step;
      }

      return {
        type: "tool",
        tool: {
          ...step.tool,
          input: toolInput,
        },
      };
    });

    if (!updatedExistingTool) {
      processSteps = [
        ...processSteps,
        {
          type: "tool",
          tool: {
            id: toolId,
            name: toolName,
            input: toolInput,
            status: "running",
            startedAt: timestamp,
          },
        },
      ];
    }
  }

  return processSteps !== nextTurn.processSteps
    ? {
        ...nextTurn,
        processSteps,
      }
    : nextTurn;
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

export const applyAssistantSnapshotAtom = atom<null, [string, unknown], void>(
  null,
  (_get, set, sessionId: string, sdkMessage: unknown) => {
    const blocks = getAssistantSnapshotBlocks(sdkMessage);
    if (blocks.length === 0) {
      return;
    }

    const hasRenderableContent = blocks.some(
      (block) =>
        (block.type === "text" && typeof block.text === "string" && block.text.length > 0) ||
        (block.type === "thinking" &&
          typeof block.thinking === "string" &&
          block.thinking.length > 0) ||
        block.type === "tool_use"
    );

    if (!hasRenderableContent) {
      return;
    }

    const timestamp = Date.now();
    const messageUuid = getAssistantSnapshotUuid(sdkMessage);
    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => {
        const nextTurn = mergeAssistantSnapshotIntoTurn(turn, blocks, timestamp);

        return messageUuid && nextTurn.id !== messageUuid
          ? {
              ...nextTurn,
              id: messageUuid,
            }
          : nextTurn;
      })
    );
  }
);

export const startBodySegmentAtom = atom<null, [string, string?, string?], void>(
  null,
  (_get, set, sessionId: string, initialText = "", segmentId?: string) => {
    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => {
        if (segmentId) {
          const existingIndex = turn.bodySegments.findIndex(
            (segment) => segment.id === segmentId
          );
          if (existingIndex !== -1) {
            if (initialText.length === 0 || turn.bodySegments[existingIndex].text.length > 0) {
              return turn;
            }
            return {
              ...turn,
              bodySegments: turn.bodySegments.map((segment, index) =>
                index === existingIndex ? { ...segment, text: initialText } : segment
              ),
            };
          }
        }

        const lastSegment = turn.bodySegments[turn.bodySegments.length - 1];
        if (
          !segmentId &&
          lastSegment &&
          lastSegment.text.length === 0 &&
          initialText.length === 0
        ) {
          return turn;
        }

        return {
          ...turn,
          bodySegments: [
            ...turn.bodySegments,
            {
              id: segmentId ?? createId("segment"),
              text: initialText,
            },
          ],
        };
      })
    );
  }
);

export const addThinkingStepAtom = atom<null, [string, string?, string?], void>(
  null,
  (_get, set, sessionId: string, initialContent = "", thinkingId?: string) => {
    const startedAt = Date.now();
    const normalizedContent = normalizeThinkingContent(initialContent);

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) => {
        if (
          thinkingId &&
          turn.processSteps.some(
            (step) => step.type === "thinking" && step.thinking.id === thinkingId
          )
        ) {
          return turn;
        }

        return {
          ...turn,
          processSteps: [
            ...turn.processSteps,
            {
              type: "thinking",
              thinking: {
                id: thinkingId || createId("thinking"),
                content: normalizedContent,
                startedAt,
              },
            },
          ],
        };
      })
    );
  }
);

export const completeThinkingStepAtom = atom<null, [string, string?], void>(
  null,
  (_get, set, sessionId: string, thinkingId?: string) => {
    const completedAt = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) =>
      updateActiveTurn(current, (turn) => {
        const targetIndex = findPendingThinkingStepIndex(turn, thinkingId);
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
      updateOrCreateActiveTurn(current, (turn) => {
        const existingIndex = turn.processSteps.findIndex(
          (step) => step.type === "tool" && step.tool.id === toolUseId
        );
        if (existingIndex !== -1) {
          return {
            ...turn,
            processSteps: turn.processSteps.map<ProcessStep>((step, index) => {
              if (index !== existingIndex || step.type !== "tool") {
                return step;
              }
              if (
                step.tool.name === toolName &&
                (input.length === 0 || step.tool.input === input)
              ) {
                return step;
              }
              return {
                type: "tool",
                tool: {
                  ...step.tool,
                  name: toolName || step.tool.name,
                  input: input.length > 0 ? input : step.tool.input,
                },
              };
            }),
          };
        }

        return {
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
        };
      })
    );
  }
);

export type StreamDelta =
  | { kind: "text"; chunk: string; entityId?: string }
  | { kind: "thinking"; chunk: string; entityId?: string }
  | { kind: "toolInput"; chunk: string; entityId?: string };

function appendStreamDelta(turn: AssistantTurn, delta: StreamDelta): AssistantTurn {
  if (delta.kind === "text") {
    const targetIndex = delta.entityId
      ? turn.bodySegments.findIndex((segment) => segment.id === delta.entityId)
      : turn.bodySegments.length - 1;
    if (targetIndex < 0) {
      return {
        ...turn,
        bodySegments: [
          ...turn.bodySegments,
          { id: delta.entityId ?? createId("segment"), text: delta.chunk },
        ],
      };
    }
    return {
      ...turn,
      bodySegments: turn.bodySegments.map((segment, index) =>
        index === targetIndex ? { ...segment, text: segment.text + delta.chunk } : segment
      ),
    };
  }

  if (delta.kind === "thinking") {
    const targetIndex = findPendingThinkingStepIndex(turn, delta.entityId);
    if (targetIndex < 0) {
      return {
        ...turn,
        processSteps: [
          ...turn.processSteps,
          {
            type: "thinking",
            thinking: {
              id: delta.entityId ?? createId("thinking"),
              content: normalizeThinkingContent(delta.chunk),
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
                content: normalizeThinkingContent(step.thinking.content + delta.chunk),
              },
            }
          : step
      ),
    };
  }

  const targetIndex = findRunningToolStepIndex(turn, delta.entityId);
  if (targetIndex < 0) {
    return turn;
  }
  return {
    ...turn,
    processSteps: turn.processSteps.map<ProcessStep>((step, index) =>
      index === targetIndex && step.type === "tool"
        ? { type: "tool", tool: { ...step.tool, input: step.tool.input + delta.chunk } }
        : step
    ),
  };
}

export const appendStreamDeltasAtom = atom<null, [string, StreamDelta[]], void>(
  null,
  (_get, set, sessionId, deltas) => {
    const nonEmptyDeltas = deltas.filter((delta) => delta.chunk.length > 0);
    if (nonEmptyDeltas.length === 0) {
      return;
    }
    set(setSessionMessagesAtom, sessionId, (current) =>
      updateOrCreateActiveTurn(current, (turn) =>
        nonEmptyDeltas.reduce(appendStreamDelta, turn)
      )
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

export const queueConversationAtom = atom<
  null,
  [string, string, string?, FileAttachment[]?],
  void
>(
  null,
  (
    _get,
    set,
    sessionId: string,
    prompt: string,
    queueUuid?: string,
    attachments?: FileAttachment[]
  ) => {
    const timestamp = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) => [
      ...current,
      {
        id: queueUuid ? `user-${queueUuid}` : createId("user"),
        role: "user",
        text: prompt.length > 0 ? prompt : undefined,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        queueState: "pending",
        queueUuid,
        timestamp,
      },
    ]);
  }
);

export const activateQueuedConversationAtom = atom<null, [string, string?], boolean>(
  null,
  (_get, set, sessionId: string, queueUuid?: string) => {
    let activated = false;
    const timestamp = Date.now();

    set(setSessionMessagesAtom, sessionId, (current) => {
      const next = activatePendingQueuedConversation(current, timestamp, queueUuid);
      activated = next !== current;
      return next;
    });

    return activated;
  }
);

/**
 * 停止发生在 Runtime 消费引导消息之前时，消息仍保留为普通产品历史。
 * 清除运行时队列状态，下一次正常执行会从 Zora 历史中读取它。
 */
export const deferQueuedConversationsAtom = atom<null, [string], void>(
  null,
  (_get, set, sessionId: string) => {
    set(setSessionMessagesAtom, sessionId, (current) =>
      current.map((message) =>
        isPendingQueuedUserMessage(message)
          ? { ...message, queueState: undefined, queueUuid: undefined }
          : message
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
 * 同时创建用户消息和一个空的流式助手 turn，让用户在首 token 到达前
 * 立刻看到 Zora 已开始工作的回显（Zora + 三个点）。
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
      createAssistantTurnMessage(timestamp),
    ]);
  }
);
