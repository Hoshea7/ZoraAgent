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
  deferQueuedConversationsAtom,
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
  pushAskUserQuestionAtom,
  removeAskUserQuestionAtom,
  clearHitlForSessionAtom,
} from "./store/hitl";
import { loadMcpConfigAtom } from "./store/mcp";
import { loadProvidersAtom } from "./store/provider";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  upsertSessionMetaInStateAtom,
  workspaceSessionsAtom,
} from "./store/workspace";
import type {
  AgentRunSource,
  AskUserQuestionRequest,
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
import { StreamSmoother } from "./utils/streamSmoother";
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

function normalizeRunSource(value: unknown): AgentRunSource | undefined {
  return value === "desktop" || value === "feishu" || value === "memory" || value === "delegation"
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

function getSdkStreamEvent(streamEvent: Record<string, unknown>) {
  return streamEvent.type === "stream_event" && isRecord(streamEvent.event)
    ? streamEvent.event
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
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const workspaceSessions = useAtomValue(workspaceSessionsAtom);
  const activeStreamBlocksRef = useRef(
    new Map<string, Map<number, ActiveStreamBlock>>()
  );
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
  const deferQueuedConversations = useSetAtom(deferQueuedConversationsAtom);
  const failTurn = useSetAtom(failTurnAtom);
  const setIsAgentIdle = useSetAtom(isAgentIdleAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const upsertSessionMetaInState = useSetAtom(upsertSessionMetaInStateAtom);
  const pushPermission = useSetAtom(pushPermissionAtom);
  const resolvePermission = useSetAtom(resolvePermissionAtom);
  const pushAskUserQuestion = useSetAtom(pushAskUserQuestionAtom);
  const removeAskUserQuestion = useSetAtom(removeAskUserQuestionAtom);
  const clearHitlForSession = useSetAtom(clearHitlForSessionAtom);

  useEffect(() => {
    if (!currentSessionId) return;
    const session = (workspaceSessions[currentWorkspaceId] ?? []).find(
      (item) => item.id === currentSessionId
    );
    if (!session?.parentSessionId) return;
    let cancelled = false;
    void window.zora.subtask
      .get({
        workspaceId: currentWorkspaceId,
        parentSessionId: session.parentSessionId,
        delegationId: session.id,
      })
      .then((summary) => {
        if (cancelled || !summary) return;
        clearHitlForSession(session.id);
        for (const interaction of summary.pendingInteractions) {
          if (interaction.type === "permission") {
            pushPermission({ request: interaction.request, sessionId: session.id });
          } else {
            pushAskUserQuestion({ request: interaction.request, sessionId: session.id });
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    clearHitlForSession,
    currentSessionId,
    currentWorkspaceId,
    pushAskUserQuestion,
    pushPermission,
    workspaceSessions,
  ]);

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

    // 流式平滑泵：text/thinking/toolInput 的 delta 统一进泵，按帧匀速放出。
    // 生命周期边界（工具完成、turn 结束、快照合并）必须先 flush，
    // 否则残留 delta 会在 turn 完成后写入错误的对象。
    const smoother = new StreamSmoother(({ key, chunk }) => {
      if (key.kind === "text") {
        appendBodyText(key.sessionId, chunk, key.entityId);
        return;
      }
      if (key.kind === "thinking") {
        appendThinking(key.sessionId, chunk, key.entityId);
        return;
      }
      appendToolInput(key.sessionId, chunk, key.entityId);
    });

    const activateQueuedBoundary = (
      sessionId: string,
      queueUuid: string | undefined,
      shouldBumpActivity: boolean
    ) => {
      const activated = activateQueuedConversation(sessionId, queueUuid);
      if (!activated) {
        return false;
      }

      clearActiveBlocks(sessionId);
      if (shouldBumpActivity) {
        bumpContentActivity();
      }
      return true;
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

      if (streamEvent.type === "subtask_snapshot") {
        const workspaceSessions = store.get(workspaceSessionsAtom);
        const workspaceId =
          Object.entries(workspaceSessions).find(([, sessions]) =>
            sessions.some((session) => session.id === streamEvent.sessionId)
          )?.[0] ?? store.get(currentWorkspaceIdAtom);
        void window.zora.listSessions(workspaceId).then((sessions) => {
          for (const session of sessions) {
            upsertSessionMetaInState({ session, workspaceId });
          }
        });
        return;
      }

      if (streamEvent.type === "permission_request" && "request" in streamEvent) {
        const request = streamEvent.request as PermissionRequest;
        if (targetSessionId) {
          pushPermission({ request, sessionId: targetSessionId });
          const childSession = Object.values(store.get(workspaceSessionsAtom))
            .flat()
            .find((session) => session.id === targetSessionId);
          const parentSessionId = childSession?.parentSessionId;
          if (parentSessionId) {
            pushPermission({
              request: {
                ...request,
                description: childSession.title
                  ? `子任务「${childSession.title}」：${request.description}`
                  : `子任务请求：${request.description}`,
              },
              sessionId: parentSessionId,
            });
          }
        }
        return;
      }

      if (streamEvent.type === "permission_resolved" && "requestId" in streamEvent) {
        resolvePermission(streamEvent.requestId as string);
        return;
      }

      if (streamEvent.type === "ask_user_request") {
        const request = streamEvent.request as AskUserQuestionRequest;
        if (targetSessionId) {
          pushAskUserQuestion({ request, sessionId: targetSessionId });
        }
        return;
      }

      if (streamEvent.type === "ask_user_resolved" && "requestId" in streamEvent) {
        removeAskUserQuestion(streamEvent.requestId as string);
        return;
      }

      if (streamEvent.type === "queued_message_accepted") {
        return;
      }

      if (streamEvent.type === "queued_message_started") {
        if (targetSessionId) {
          activateQueuedBoundary(
            targetSessionId,
            streamEvent.uuid,
            isCurrentSessionEvent
          );
        }
        return;
      }

      if (streamEvent.type === "agent_error") {
        if (targetSessionId) {
          smoother.flush(targetSessionId);
        }

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
          }

          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
          return;
        }

        if (streamEvent.status === "finished") {
          if (targetSessionId) {
            smoother.flush(targetSessionId);
            clearActiveBlocks(targetSessionId);
          }

          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
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
          if (targetSessionId) {
            smoother.flush(targetSessionId);
            clearActiveBlocks(targetSessionId);
          }

          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
            deferQueuedConversations(eventSessionId);
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

      if (streamEvent.type === "system" && streamEvent.subtype === "status") {
        const compactionStepId = `compaction-${targetSessionId}`;
        if (streamEvent.status === "compacting") {
          addThinkingStep(targetSessionId, "正在整理上下文", compactionStepId);
        } else {
          completeThinkingStep(targetSessionId, compactionStepId);
        }
        return;
      }

      if (streamEvent.type === "user" && isRecord(streamEvent.message)) {
        smoother.flush(targetSessionId, { kind: "toolInput" });

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

        return;
      }

      if (streamEvent.type === "assistant") {
        if (isRecord(streamEvent.message)) {
          // 快照合并前先倒空泵：快照是全量文本，泵内残留再 append 会重复
          smoother.flush(targetSessionId);
          applyAssistantSnapshot(targetSessionId, streamEvent);
          clearActiveBlocks(targetSessionId);
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        }
        return;
      }

      if (streamEvent.type === "result") {
        smoother.flush(targetSessionId);
        clearActiveBlocks(targetSessionId);
        completeTurn(targetSessionId, "done");
        if (isCurrentSessionEvent) {
          clearIdleTimer();
          setIsAgentIdle(false);
        }
        return;
      }

      const sdkEvent = getSdkStreamEvent(streamEvent);
      if (sdkEvent) {
        if (sdkEvent.type === "message_start") {
          clearActiveBlocks(targetSessionId);
        }
      }

      const chunks = extractStreamChunks(streamEvent);

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
        smoother.enqueue(
          {
            sessionId: targetSessionId,
            kind: "text",
            entityId: block?.type === "text" ? block.entityId : undefined,
          },
          chunks.textDelta
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
            smoother.enqueue(
              { sessionId: targetSessionId, kind: "thinking", entityId: block.entityId },
              nextChunk
            );
          }
          block.seed = "";
        } else {
          smoother.enqueue(
            {
              sessionId: targetSessionId,
              kind: "thinking",
              entityId: block?.type === "thinking" ? block.entityId : undefined,
            },
            chunks.thinkingDelta
          );
        }
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.toolInputDelta) {
        const block = getActiveBlocks(targetSessionId).get(chunks.contentIndex ?? -1);
        smoother.enqueue(
          {
            sessionId: targetSessionId,
            kind: "toolInput",
            entityId: block?.type === "tool_use" ? block.entityId : undefined,
          },
          chunks.toolInputDelta
        );
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.blockStopIndex !== undefined) {
        const activeBlocks = getActiveBlocks(targetSessionId);
        const block = activeBlocks.get(chunks.blockStopIndex);
        // block 结束前先倒空该槽的泵残留：completeThinkingStep 后 thinking
        // 不再是 pending 状态，残留 delta 会错误地新建一个 thinking step
        if (block) {
          smoother.flush(targetSessionId, { entityId: block.entityId });
        }
        completeStreamingBlock(targetSessionId);
        if (block?.type === "thinking") {
          completeThinkingStep(targetSessionId, block.entityId);
        }
        activeBlocks.delete(chunks.blockStopIndex);
      }
    });

    return () => {
      smoother.flushAll();
      smoother.dispose();
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
    pushAskUserQuestion,
    removeAskUserQuestion,
    clearHitlForSession,
  ]);

  return <AppShell />;
}
