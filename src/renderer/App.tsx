import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  addThinkingStepAtom,
  addToolStepAtom,
  applyAssistantSnapshotAtom,
  appendBodyTextAtom,
  appendThinkingAtom,
  appendToolInputAtom,
  activateQueuedConversationAtom,
  completeStreamingBlockAtom,
  completeThinkingStepAtom,
  completeToolResultAtom,
  completeTurnAtom,
  ensureActiveTurnAtom,
  failTurnAtom,
  isAgentIdleAtom,
  sessionMessagesAtom,
  setSessionMessagesAtom,
  setSessionRunningAtom,
  startBodySegmentAtom,
} from "./store/chat";
import {
  pushPermissionAtom,
  resolvePermissionAtom,
  pushAskUserAtom,
  resolveAskUserAtom,
  clearHitlForSessionAtom,
} from "./store/hitl";
import { loadMcpConfigAtom } from "./store/mcp";
import { loadProvidersAtom } from "./store/provider";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  upsertSessionMetaInStateAtom,
} from "./store/workspace";
import type {
  AgentRunSource,
  AskUserRequest,
  ConversationMessage,
  PermissionRequest,
  SessionMeta,
} from "../shared/zora";
import {
  createId,
  extractStreamChunks,
  extractToolResultContent,
  getAgentErrorText,
  isRecord,
} from "./utils/message";
import { AppShell } from "./components/layout/AppShell";

type ActiveStreamBlock =
  | { type: "text"; entityId: string }
  | {
      type: "thinking";
      entityId: string;
      seed: string;
      hasDelta: boolean;
    }
  | { type: "tool_use"; entityId: string };

interface BufferedToolInput {
  sessionId: string;
  toolUseId?: string;
  content: string;
}

function normalizeRunSource(value: unknown): AgentRunSource | undefined {
  return value === "desktop" || value === "feishu" || value === "memory"
    ? value
    : undefined;
}

function stripThinkingSeedOverlap(seed: string, delta: string): string {
  if (seed.length === 0) {
    return delta;
  }

  const maxOverlap = Math.min(seed.length, delta.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (seed.slice(-overlap) === delta.slice(0, overlap)) {
      return delta.slice(overlap);
    }
  }

  return delta;
}

function hasQueuedUserPromptContent(message: Record<string, unknown>) {
  const content = message.content;

  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.some(
    (block) =>
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.trim().length > 0
  );
}

function getSdkStreamEvent(streamEvent: Record<string, unknown>) {
  return streamEvent.type === "stream_event" && isRecord(streamEvent.event)
    ? streamEvent.event
    : null;
}

function getSdkStopReason(event: Record<string, unknown>) {
  return event.type === "message_delta" && typeof event.stop_reason === "string"
    ? event.stop_reason
    : null;
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.timestamp === "number"
  );
}

function isSessionMeta(value: unknown): value is SessionMeta {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function mergeConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[]
): ConversationMessage[] {
  if (incoming.length === 0) {
    return current;
  }

  const nextMessages = [...current];
  const indexesById = new Map(current.map((message, index) => [message.id, index]));
  let changed = false;

  for (const message of incoming) {
    const existingIndex = indexesById.get(message.id);
    if (existingIndex === undefined) {
      indexesById.set(message.id, nextMessages.length);
      nextMessages.push(message);
      changed = true;
      continue;
    }

    const existing = nextMessages[existingIndex];
    if (
      existing.role === "assistant" &&
      existing.turn?.status === "streaming" &&
      message.role === "assistant"
    ) {
      continue;
    }

    nextMessages[existingIndex] = {
      ...existing,
      ...message,
    };
    changed = true;
  }

  return changed ? nextMessages : current;
}

export default function App() {
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const toolInputBufferRef = useRef(new Map<string, BufferedToolInput>());
  const toolInputFlushTimerRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activeStreamBlocksRef = useRef(
    new Map<string, Map<number, ActiveStreamBlock>>()
  );
  const queuedFallbackReadyRef = useRef(new Set<string>());
  const queuedReplayAckRef = useRef(new Map<string, string | undefined>());
  const lastAssistantStopReasonRef = useRef(new Map<string, string | null>());
  const store = useStore();
  const loadProviders = useSetAtom(loadProvidersAtom);
  const loadMcpConfig = useSetAtom(loadMcpConfigAtom);
  const setSessionMessages = useSetAtom(setSessionMessagesAtom);

  const ensureActiveTurn = useSetAtom(ensureActiveTurnAtom);
  const startBodySegment = useSetAtom(startBodySegmentAtom);
  const appendBodyText = useSetAtom(appendBodyTextAtom);
  const applyAssistantSnapshot = useSetAtom(applyAssistantSnapshotAtom);
  const addThinkingStep = useSetAtom(addThinkingStepAtom);
  const appendThinking = useSetAtom(appendThinkingAtom);
  const completeThinkingStep = useSetAtom(completeThinkingStepAtom);
  const addToolStep = useSetAtom(addToolStepAtom);
  const appendToolInput = useSetAtom(appendToolInputAtom);
  const activateQueuedConversation = useSetAtom(activateQueuedConversationAtom);
  const completeStreamingBlock = useSetAtom(completeStreamingBlockAtom);
  const completeToolResult = useSetAtom(completeToolResultAtom);
  const completeTurn = useSetAtom(completeTurnAtom);
  const failTurn = useSetAtom(failTurnAtom);
  const setIsAgentIdle = useSetAtom(isAgentIdleAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const upsertSessionMetaInState = useSetAtom(upsertSessionMetaInStateAtom);
  const pushPermission = useSetAtom(pushPermissionAtom);
  const resolvePermission = useSetAtom(resolvePermissionAtom);
  const pushAskUser = useSetAtom(pushAskUserAtom);
  const resolveAskUser = useSetAtom(resolveAskUserAtom);
  const clearHitlForSession = useSetAtom(clearHitlForSessionAtom);

  useEffect(() => {
    void loadProviders().catch((error) => {
      console.warn("[app] Failed to load providers.", error);
    });
  }, [loadProviders]);

  useEffect(() => {
    void loadMcpConfig().catch((error) => {
      console.warn("[app] Failed to load MCP config.", error);
    });
  }, [loadMcpConfig]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    let cancelled = false;

    void window.zora
      .getAgentRunInfo(currentSessionId)
      .then((runInfo) => {
        if (cancelled) {
          return;
        }

        setSessionRunning(currentSessionId, runInfo.running, runInfo.source);
      })
      .catch((error) => {
        console.warn("[app] Failed to sync agent state for session.", {
          sessionId: currentSessionId,
          error,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, setSessionRunning]);

  useEffect(() => {
    const unsubscribe = window.zora.feishu.onAgentStateChanged((payload) => {
      setSessionRunning(payload.sessionId, payload.running, payload.running ? "feishu" : undefined);
    });

    return () => {
      unsubscribe();
    };
  }, [setSessionRunning]);

  useEffect(() => {
    const zora = window.zora;
    if (!zora) {
      return;
    }

    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
    };

    const bumpContentActivity = () => {
      setIsAgentIdle(false);
      clearIdleTimer();
      idleTimer = setTimeout(() => setIsAgentIdle(true), 450);
    };

    const getActiveBlocks = (sessionId: string) => {
      let blocks = activeStreamBlocksRef.current.get(sessionId);
      if (!blocks) {
        blocks = new Map<number, ActiveStreamBlock>();
        activeStreamBlocksRef.current.set(sessionId, blocks);
      }
      return blocks;
    };

    const clearActiveBlocks = (sessionId: string) => {
      activeStreamBlocksRef.current.delete(sessionId);
    };

    const toolInputKey = (sessionId: string, toolUseId?: string) =>
      `${sessionId}:${toolUseId ?? "active"}`;

    const flushToolInput = (sessionId: string, toolUseId?: string) => {
      const keys = toolUseId
        ? [toolInputKey(sessionId, toolUseId)]
        : [...toolInputBufferRef.current.keys()].filter((key) =>
            key.startsWith(`${sessionId}:`)
          );

      for (const key of keys) {
        const pending = toolInputBufferRef.current.get(key);
        if (!pending) {
          continue;
        }

        toolInputBufferRef.current.delete(key);
        const timer = toolInputFlushTimerRef.current.get(key);
        if (timer) {
          clearTimeout(timer);
          toolInputFlushTimerRef.current.delete(key);
        }

        appendToolInput(
          pending.sessionId,
          pending.content,
          pending.toolUseId
        );
      }
    };

    const scheduleToolInputFlush = (
      sessionId: string,
      chunk: string,
      toolUseId?: string
    ) => {
      const key = toolInputKey(sessionId, toolUseId);
      const previous = toolInputBufferRef.current.get(key);
      toolInputBufferRef.current.set(key, {
        sessionId,
        toolUseId,
        content: `${previous?.content ?? ""}${chunk}`,
      });

      if (toolInputFlushTimerRef.current.has(key)) {
        return;
      }

      const timer = setTimeout(() => {
        flushToolInput(sessionId, toolUseId);
      }, 48);

      toolInputFlushTimerRef.current.set(key, timer);
    };

    const activateQueuedBoundary = (
      sessionId: string,
      queueUuid: string | undefined,
      shouldBumpActivity: boolean
    ) => {
      const activated = activateQueuedConversation(sessionId, queueUuid);
      if (!activated) {
        return false;
      }

      queuedFallbackReadyRef.current.delete(sessionId);
      queuedReplayAckRef.current.delete(sessionId);
      clearActiveBlocks(sessionId);
      if (shouldBumpActivity) {
        bumpContentActivity();
      }
      return true;
    };

    const hasPendingQueuedMessages = (sessionId: string) =>
      (store.get(sessionMessagesAtom)[sessionId] ?? []).some(
        (message) => message.role === "user" && message.queueState === "pending"
      );

    const tryActivateQueuedBoundary = (sessionId: string, shouldBumpActivity: boolean) => {
      if (
        !queuedFallbackReadyRef.current.has(sessionId) ||
        !queuedReplayAckRef.current.has(sessionId)
      ) {
        return false;
      }

      return activateQueuedBoundary(
        sessionId,
        queuedReplayAckRef.current.get(sessionId),
        shouldBumpActivity
      );
    };

    const markQueuedBoundaryReady = (
      sessionId: string,
      shouldBumpActivity: boolean,
      activateNow = true
    ) => {
      if (hasPendingQueuedMessages(sessionId)) {
        queuedFallbackReadyRef.current.add(sessionId);
        if (activateNow) {
          tryActivateQueuedBoundary(sessionId, shouldBumpActivity);
        }
      }
    };

    const markQueuedReplayAcknowledged = (
      sessionId: string,
      queueUuid: string | undefined,
      shouldBumpActivity: boolean
    ) => {
      if (!hasPendingQueuedMessages(sessionId)) {
        return;
      }

      queuedReplayAckRef.current.set(sessionId, queueUuid);
      tryActivateQueuedBoundary(sessionId, shouldBumpActivity);
    };

    const flushAllToolInput = () => {
      const sessionIds = new Set(
        [...toolInputBufferRef.current.values()].map((pending) => pending.sessionId)
      );
      sessionIds.forEach((sessionId) => {
        flushToolInput(sessionId);
      });
    };

    const unsubscribe = zora.onStream((streamEvent) => {
      const eventSessionId = streamEvent.sessionId;
      const activeSessionId = store.get(currentSessionIdAtom);
      const isCurrentSessionEvent = eventSessionId === activeSessionId;
      const targetSessionId = eventSessionId ?? activeSessionId;

      if (streamEvent.type === "session_sync") {
        const workspaceId =
          typeof streamEvent.workspaceId === "string" ? streamEvent.workspaceId : undefined;
        const targetWorkspaceId = workspaceId ?? store.get(currentWorkspaceIdAtom);

        const syncSessionId =
          typeof streamEvent.sessionId === "string" ? streamEvent.sessionId : undefined;
        if (!syncSessionId) {
          return;
        }

        const session = isSessionMeta(streamEvent.session) ? streamEvent.session : null;
        const syncedMessages = Array.isArray(streamEvent.messages)
          ? streamEvent.messages.filter(isConversationMessage)
          : [];

        if (session) {
          upsertSessionMetaInState({
            session,
            workspaceId: targetWorkspaceId,
          });
        }

        const cachedMessages = store.get(sessionMessagesAtom);
        if (Object.prototype.hasOwnProperty.call(cachedMessages, syncSessionId)) {
          setSessionMessages(syncSessionId, (current) =>
            mergeConversationMessages(current, syncedMessages)
          );
        } else {
          setSessionMessages(syncSessionId, syncedMessages);
        }
        return;
      }

      if (streamEvent.type === "permission_request" && "request" in streamEvent) {
        const request = streamEvent.request as PermissionRequest;
        if (targetSessionId) {
          pushPermission({ request, sessionId: targetSessionId });
        }
        return;
      }

      if (streamEvent.type === "permission_resolved" && "requestId" in streamEvent) {
        resolvePermission(streamEvent.requestId as string);
        return;
      }

      if (streamEvent.type === "ask_user_request" && "request" in streamEvent) {
        const request = streamEvent.request as AskUserRequest;
        if (targetSessionId) {
          pushAskUser({ request, sessionId: targetSessionId });
        }
        return;
      }

      if (streamEvent.type === "ask_user_resolved" && "requestId" in streamEvent) {
        resolveAskUser(streamEvent.requestId as string);
        return;
      }

      if (streamEvent.type === "agent_error") {
        flushAllToolInput();

        if (eventSessionId) {
          setSessionRunning(eventSessionId, false);
        }

        if (targetSessionId) {
          clearActiveBlocks(targetSessionId);
          failTurn(
            targetSessionId,
            getAgentErrorText(isRecord(streamEvent) ? streamEvent.error : undefined)
          );
          clearHitlForSession(targetSessionId);
        }

        if (isCurrentSessionEvent) {
          clearIdleTimer();
          setIsAgentIdle(false);
        }
        return;
      }

      if (streamEvent.type === "agent_status") {
        if (streamEvent.status === "started") {
          if (eventSessionId) {
            setSessionRunning(eventSessionId, true, normalizeRunSource(streamEvent.source));
            if (
              queuedFallbackReadyRef.current.has(eventSessionId) &&
              hasPendingQueuedMessages(eventSessionId)
            ) {
              activateQueuedBoundary(
                eventSessionId,
                queuedReplayAckRef.current.get(eventSessionId),
                isCurrentSessionEvent
              );
            } else {
              queuedFallbackReadyRef.current.delete(eventSessionId);
              queuedReplayAckRef.current.delete(eventSessionId);
            }
            lastAssistantStopReasonRef.current.delete(eventSessionId);
          }

          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
          return;
        }

        if (streamEvent.status === "finished") {
          flushAllToolInput();

          if (targetSessionId) {
            clearActiveBlocks(targetSessionId);
          }

          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
            if (!hasPendingQueuedMessages(eventSessionId)) {
              queuedFallbackReadyRef.current.delete(eventSessionId);
              queuedReplayAckRef.current.delete(eventSessionId);
              lastAssistantStopReasonRef.current.delete(eventSessionId);
            }
          }

          if (targetSessionId) {
            completeTurn(targetSessionId, "done");
            clearHitlForSession(targetSessionId);
          }

          if (isCurrentSessionEvent) {
            clearIdleTimer();
            setIsAgentIdle(false);
          }

        }

        if (streamEvent.status === "stopped") {
          flushAllToolInput();

          if (targetSessionId) {
            clearActiveBlocks(targetSessionId);
          }

          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
            queuedFallbackReadyRef.current.delete(eventSessionId);
            queuedReplayAckRef.current.delete(eventSessionId);
            lastAssistantStopReasonRef.current.delete(eventSessionId);
          }

          if (targetSessionId) {
            completeTurn(targetSessionId, "stopped");
            clearHitlForSession(targetSessionId);
          }

          if (isCurrentSessionEvent) {
            clearIdleTimer();
            setIsAgentIdle(false);
          }
        }

        return;
      }

      if (!targetSessionId) {
        return;
      }

      if (streamEvent.type === "user" && isRecord(streamEvent.message)) {
        flushToolInput(targetSessionId);

        const content = streamEvent.message.content;
        let hasToolResult = false;

        if (Array.isArray(content)) {
          content.forEach((block) => {
            if (
              isRecord(block) &&
              block.type === "tool_result" &&
              typeof block.tool_use_id === "string"
            ) {
              completeToolResult(
                targetSessionId,
                block.tool_use_id,
                extractToolResultContent(block.content),
                block.is_error === true
              );
              hasToolResult = true;
              if (isCurrentSessionEvent) {
                bumpContentActivity();
              }
            }
          });
        }

        if (hasToolResult) {
          markQueuedBoundaryReady(targetSessionId, isCurrentSessionEvent);
        }

        if (
          !hasToolResult &&
          streamEvent.isReplay === true &&
          (typeof streamEvent.uuid === "string" ||
            hasQueuedUserPromptContent(streamEvent.message))
        ) {
          const queueUuid = typeof streamEvent.uuid === "string" ? streamEvent.uuid : undefined;
          markQueuedReplayAcknowledged(targetSessionId, queueUuid, isCurrentSessionEvent);
        }

        return;
      }

      if (streamEvent.type === "assistant") {
        if (isRecord(streamEvent.message)) {
          applyAssistantSnapshot(targetSessionId, streamEvent);
          clearActiveBlocks(targetSessionId);
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        }
        return;
      }

      if (streamEvent.type === "result") {
        flushToolInput(targetSessionId);
        clearActiveBlocks(targetSessionId);
        completeTurn(targetSessionId, "done");
        markQueuedBoundaryReady(targetSessionId, isCurrentSessionEvent, false);
        if (isCurrentSessionEvent) {
          clearIdleTimer();
          setIsAgentIdle(false);
        }
        return;
      }

      const sdkEvent = getSdkStreamEvent(streamEvent);
      if (sdkEvent) {
        const stopReason = getSdkStopReason(sdkEvent);
        if (stopReason !== null) {
          lastAssistantStopReasonRef.current.set(targetSessionId, stopReason);
        }

        if (sdkEvent.type === "message_stop") {
          const lastStopReason = lastAssistantStopReasonRef.current.get(targetSessionId);
          if (lastStopReason !== "tool_use") {
            markQueuedBoundaryReady(targetSessionId, isCurrentSessionEvent);
          }
        }

        if (sdkEvent.type === "message_start" && queuedFallbackReadyRef.current.has(targetSessionId)) {
          tryActivateQueuedBoundary(targetSessionId, isCurrentSessionEvent);
        }
        if (sdkEvent.type === "message_start") {
          clearActiveBlocks(targetSessionId);
        }
      }

      const chunks = extractStreamChunks(streamEvent);
      if (
        queuedFallbackReadyRef.current.has(targetSessionId) &&
        (chunks.blockStart ||
          chunks.textDelta ||
          chunks.thinkingDelta ||
          chunks.toolInputDelta)
      ) {
        tryActivateQueuedBoundary(targetSessionId, isCurrentSessionEvent);
      }

      if (chunks.blockStart) {
        const contentIndex = chunks.contentIndex ?? -1;
        const activeBlocks = getActiveBlocks(targetSessionId);
        if (chunks.blockStart.type === "tool_use") {
          ensureActiveTurn(targetSessionId);
          addToolStep(
            targetSessionId,
            chunks.blockStart.toolName,
            chunks.blockStart.toolUseId,
            chunks.blockStart.toolInput
          );
          if (contentIndex >= 0) {
            activeBlocks.set(contentIndex, {
              type: "tool_use",
              entityId: chunks.blockStart.toolUseId,
            });
          }
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        } else {
          ensureActiveTurn(targetSessionId);
          if (chunks.blockStart.type === "text") {
            const segmentId = createId(`segment-${contentIndex}`);
            startBodySegment(
              targetSessionId,
              chunks.blockStart.text ?? "",
              segmentId
            );
            activeBlocks.set(contentIndex, { type: "text", entityId: segmentId });
          } else {
            const initialThinking = chunks.blockStart.thinking ?? "";
            const thinkingId = chunks.blockStart.thinkingId ?? createId(`thinking-${contentIndex}`);
            addThinkingStep(targetSessionId, initialThinking, thinkingId);
            activeBlocks.set(contentIndex, {
              type: "thinking",
              entityId: thinkingId,
              seed: initialThinking,
              hasDelta: false,
            });
          }
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        }
      }

      if (chunks.textDelta) {
        const block = getActiveBlocks(targetSessionId).get(chunks.contentIndex ?? -1);
        appendBodyText(
          targetSessionId,
          chunks.textDelta,
          block?.type === "text" ? block.entityId : undefined
        );
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.thinkingDelta) {
        const block = getActiveBlocks(targetSessionId).get(chunks.contentIndex ?? -1);
        if (block?.type === "thinking" && !block.hasDelta) {
          block.hasDelta = true;
          const nextChunk = stripThinkingSeedOverlap(
            block.seed,
            chunks.thinkingDelta
          );
          if (nextChunk.length > 0) {
            appendThinking(targetSessionId, nextChunk, block.entityId);
          }
          block.seed = "";
        } else {
          appendThinking(
            targetSessionId,
            chunks.thinkingDelta,
            block?.type === "thinking" ? block.entityId : undefined
          );
        }
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.toolInputDelta) {
        const block = getActiveBlocks(targetSessionId).get(chunks.contentIndex ?? -1);
        scheduleToolInputFlush(
          targetSessionId,
          chunks.toolInputDelta,
          block?.type === "tool_use" ? block.entityId : undefined
        );
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.blockStopIndex !== undefined) {
        const activeBlocks = getActiveBlocks(targetSessionId);
        const block = activeBlocks.get(chunks.blockStopIndex);
        if (block?.type === "tool_use") {
          flushToolInput(targetSessionId, block.entityId);
        }
        completeStreamingBlock(targetSessionId);
        if (block?.type === "thinking") {
          completeThinkingStep(targetSessionId, block.entityId);
        }
        activeBlocks.delete(chunks.blockStopIndex);
      }
    });

    return () => {
      flushAllToolInput();
      toolInputFlushTimerRef.current.forEach((timer) => clearTimeout(timer));
      toolInputFlushTimerRef.current.clear();
      clearIdleTimer();
      unsubscribe();
    };
  }, [
    ensureActiveTurn,
    startBodySegment,
    appendBodyText,
    applyAssistantSnapshot,
    addThinkingStep,
    appendThinking,
    completeThinkingStep,
    addToolStep,
    appendToolInput,
    completeStreamingBlock,
    completeToolResult,
    activateQueuedConversation,
    completeTurn,
    failTurn,
    setIsAgentIdle,
    store,
    setSessionMessages,
    setSessionRunning,
    upsertSessionMetaInState,
    pushPermission,
    resolvePermission,
    pushAskUser,
    resolveAskUser,
    clearHitlForSession,
  ]);

  return <AppShell />;
}
