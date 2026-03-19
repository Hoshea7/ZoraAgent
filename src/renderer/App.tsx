import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  addThinkingStepAtom,
  addToolStepAtom,
  appendBodyTextAtom,
  appendThinkingAtom,
  appendToolInputAtom,
  completeStreamingBlockAtom,
  completeThinkingStepAtom,
  completeToolResultAtom,
  completeTurnAtom,
  ensureActiveTurnAtom,
  failTurnAtom,
  isAgentIdleAtom,
  messagesAtom,
  setSessionRunningAtom,
  startBodySegmentAtom,
} from "./store/chat";
import {
  appPhaseAtom,
  checkAwakeningAtom,
  completeAwakeningAtom,
} from "./store/zora";
import {
  pushPermissionAtom,
  resolvePermissionAtom,
  pushAskUserAtom,
  resolveAskUserAtom,
  clearHitlForSessionAtom,
} from "./store/hitl";
import { loadProvidersAtom } from "./store/provider";
import { currentSessionIdAtom } from "./store/workspace";
import type {
  AgentRunSource,
  AskUserRequest,
  PermissionRequest,
} from "../shared/zora";
import {
  extractStreamChunks,
  extractToolResultContent,
  getAgentErrorText,
  isRecord,
} from "./utils/message";
import { AppShell } from "./components/layout/AppShell";
import { AwakeningDialogue } from "./components/awakening/AwakeningDialogue";
import { AwakeningCanvas } from "./components/awakening/AwakeningCanvas";
import { AwakeningComplete } from "./components/awakening/AwakeningComplete";

function normalizeRunSource(value: unknown): AgentRunSource | undefined {
  return value === "desktop" || value === "feishu" || value === "awakening" || value === "memory"
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

export default function App() {
  const appPhase = useAtomValue(appPhaseAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const appPhaseRef = useRef(appPhase);
  const toolInputBufferRef = useRef(new Map<string, string>());
  const toolInputFlushTimerRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activeBlockTypeRef = useRef<string | null>(null);
  const pendingThinkingSeedRef = useRef("");
  const activeThinkingHasDeltaRef = useRef(false);
  const store = useStore();
  const checkAwakening = useSetAtom(checkAwakeningAtom);
  const completeAwakening = useSetAtom(completeAwakeningAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const setMessages = useSetAtom(messagesAtom);

  const ensureActiveTurn = useSetAtom(ensureActiveTurnAtom);
  const startBodySegment = useSetAtom(startBodySegmentAtom);
  const appendBodyText = useSetAtom(appendBodyTextAtom);
  const addThinkingStep = useSetAtom(addThinkingStepAtom);
  const appendThinking = useSetAtom(appendThinkingAtom);
  const completeThinkingStep = useSetAtom(completeThinkingStepAtom);
  const addToolStep = useSetAtom(addToolStepAtom);
  const appendToolInput = useSetAtom(appendToolInputAtom);
  const completeStreamingBlock = useSetAtom(completeStreamingBlockAtom);
  const completeToolResult = useSetAtom(completeToolResultAtom);
  const completeTurn = useSetAtom(completeTurnAtom);
  const failTurn = useSetAtom(failTurnAtom);
  const setIsAgentIdle = useSetAtom(isAgentIdleAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const pushPermission = useSetAtom(pushPermissionAtom);
  const resolvePermission = useSetAtom(resolvePermissionAtom);
  const pushAskUser = useSetAtom(pushAskUserAtom);
  const resolveAskUser = useSetAtom(resolveAskUserAtom);
  const clearHitlForSession = useSetAtom(clearHitlForSessionAtom);

  useEffect(() => {
    checkAwakening();
  }, [checkAwakening]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    appPhaseRef.current = appPhase;
  }, [appPhase]);

  useEffect(() => {
    if (appPhase !== "chat" || !currentSessionId) {
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
  }, [appPhase, currentSessionId, setSessionRunning]);

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

    const resetThinkingStreamState = () => {
      pendingThinkingSeedRef.current = "";
      activeThinkingHasDeltaRef.current = false;
    };

    const flushPendingThinkingSeed = (_sessionId: string) => {
      resetThinkingStreamState();
    };

    const flushToolInput = (sessionId: string) => {
      const pending = toolInputBufferRef.current.get(sessionId);
      if (!pending) {
        return;
      }

      toolInputBufferRef.current.delete(sessionId);

      const timer = toolInputFlushTimerRef.current.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        toolInputFlushTimerRef.current.delete(sessionId);
      }

      appendToolInput(sessionId, pending);
    };

    const scheduleToolInputFlush = (sessionId: string, chunk: string) => {
      const previous = toolInputBufferRef.current.get(sessionId) ?? "";
      toolInputBufferRef.current.set(sessionId, `${previous}${chunk}`);

      if (toolInputFlushTimerRef.current.has(sessionId)) {
        return;
      }

      const timer = setTimeout(() => {
        flushToolInput(sessionId);
      }, 48);

      toolInputFlushTimerRef.current.set(sessionId, timer);
    };

    const flushAllToolInput = () => {
      Array.from(toolInputBufferRef.current.keys()).forEach((sessionId) => {
        flushToolInput(sessionId);
      });
    };

    const unsubscribe = zora.onStream((streamEvent) => {
      const eventSessionId = streamEvent.sessionId;
      const activeSessionId = store.get(currentSessionIdAtom);
      const activeMessageSessionId =
        appPhaseRef.current.startsWith("awakening") ? "__awakening__" : activeSessionId;
      const isCurrentSessionEvent = eventSessionId === activeMessageSessionId;
      const targetSessionId = eventSessionId ?? activeMessageSessionId;

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
          flushPendingThinkingSeed(targetSessionId);
          activeBlockTypeRef.current = null;
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
          flushAllToolInput();

          if (targetSessionId) {
            flushPendingThinkingSeed(targetSessionId);
          }
          activeBlockTypeRef.current = null;

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

          if (appPhaseRef.current.startsWith("awakening") && isCurrentSessionEvent) {
            void zora.isAwakened().then((awakened) => {
              if (awakened) {
                void zora.awakeningComplete().then(() => {
                  setMessages([]);
                  completeAwakening();
                }).catch(() => {
                  setMessages([]);
                  completeAwakening();
                });
              }
            });
          }
        }

        if (streamEvent.status === "stopped") {
          flushAllToolInput();

          if (targetSessionId) {
            flushPendingThinkingSeed(targetSessionId);
          }
          activeBlockTypeRef.current = null;

          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
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
              if (isCurrentSessionEvent) {
                bumpContentActivity();
              }
            }
          });
        }
        return;
      }

      if (streamEvent.type === "assistant") {
        return;
      }

      if (streamEvent.type === "result") {
        flushToolInput(targetSessionId);
        flushPendingThinkingSeed(targetSessionId);
        if (isCurrentSessionEvent) {
          clearIdleTimer();
          setIsAgentIdle(false);
        }
        return;
      }

      const chunks = extractStreamChunks(streamEvent);
      if (chunks.blockStart) {
        if (chunks.blockStart.type === "tool_use") {
          if (activeBlockTypeRef.current === "thinking") {
            flushPendingThinkingSeed(targetSessionId);
          }
          ensureActiveTurn(targetSessionId);
          addToolStep(
            targetSessionId,
            chunks.blockStart.toolName,
            chunks.blockStart.toolUseId,
            chunks.blockStart.toolInput
          );
          activeBlockTypeRef.current = "tool_use";
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        } else {
          ensureActiveTurn(targetSessionId);
          if (chunks.blockStart.type === "text") {
            if (activeBlockTypeRef.current === "thinking") {
              flushPendingThinkingSeed(targetSessionId);
            } else {
              resetThinkingStreamState();
            }
            startBodySegment(targetSessionId, chunks.blockStart.text ?? "");
            activeBlockTypeRef.current = "text";
          } else {
            const initialThinking = chunks.blockStart.thinking ?? "";
            pendingThinkingSeedRef.current = initialThinking;
            activeThinkingHasDeltaRef.current = false;
            addThinkingStep(targetSessionId, initialThinking);
            activeBlockTypeRef.current = "thinking";
          }
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        }
      }

      if (chunks.textDelta) {
        appendBodyText(targetSessionId, chunks.textDelta);
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.thinkingDelta) {
        if (activeBlockTypeRef.current === "thinking" && !activeThinkingHasDeltaRef.current) {
          activeThinkingHasDeltaRef.current = true;
          const nextChunk = stripThinkingSeedOverlap(
            pendingThinkingSeedRef.current,
            chunks.thinkingDelta
          );
          if (nextChunk.length > 0) {
            appendThinking(targetSessionId, nextChunk);
          }
          pendingThinkingSeedRef.current = "";
        } else {
          appendThinking(targetSessionId, chunks.thinkingDelta);
        }
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.toolInputDelta) {
        scheduleToolInputFlush(targetSessionId, chunks.toolInputDelta);
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (
        streamEvent.type === "stream_event" &&
        isRecord(streamEvent.event) &&
        streamEvent.event.type === "content_block_stop"
      ) {
        flushToolInput(targetSessionId);
        completeStreamingBlock(targetSessionId);
        if (activeBlockTypeRef.current === "thinking") {
          flushPendingThinkingSeed(targetSessionId);
          completeThinkingStep(targetSessionId);
        }
        activeBlockTypeRef.current = null;
        resetThinkingStreamState();
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
    addThinkingStep,
    appendThinking,
    completeThinkingStep,
    addToolStep,
    appendToolInput,
    completeStreamingBlock,
    completeToolResult,
    completeTurn,
    failTurn,
    setIsAgentIdle,
    store,
    completeAwakening,
    setMessages,
    setSessionRunning,
    pushPermission,
    resolvePermission,
    pushAskUser,
    resolveAskUser,
    clearHitlForSession,
  ]);

  if (appPhase === "splash") {
    return null;
  }

  if (appPhase === "awakening-visual") {
    return <AwakeningCanvas />;
  }

  if (appPhase === "awakening-dialogue") {
    return <AwakeningDialogue />;
  }

  if (appPhase === "awakening-complete") {
    return <AwakeningComplete />;
  }

  return <AppShell />;
}
