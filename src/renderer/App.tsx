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
  completeAwakeningAtom
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
import type { PermissionRequest, AskUserRequest } from "../shared/zora";
import {
  extractStreamChunks,
  extractToolResultContent,
  getAgentErrorText,
  isRecord
} from "./utils/message";
import { AppShell } from "./components/layout/AppShell";
import { AwakeningDialogue } from "./components/awakening/AwakeningDialogue";
import { AwakeningCanvas } from "./components/awakening/AwakeningCanvas";
import { AwakeningComplete } from "./components/awakening/AwakeningComplete";

function mergeThinkingSeedWithDelta(seed: string, delta: string): string {
  if (seed.length === 0) {
    return delta;
  }

  const maxOverlap = Math.min(seed.length, delta.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (seed.slice(-overlap) === delta.slice(0, overlap)) {
      return `${seed}${delta.slice(overlap)}`;
    }
  }

  return `${seed}${delta}`;
}

/**
 * 应用根组件
 * 管理 App 生命周期阶段（splash → awakening → chat）
 * 负责初始化和流式事件处理
 */
export default function App() {
  const appPhase = useAtomValue(appPhaseAtom);
  const appPhaseRef = useRef(appPhase);
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

  // 启动阶段：检查唤醒状态
  useEffect(() => {
    checkAwakening();
  }, [checkAwakening]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    console.log(`[app] Current mode: ${appPhase}`);
  }, [appPhase]);

  useEffect(() => {
    appPhaseRef.current = appPhase;
  }, [appPhase]);

  // 处理 Agent 流式事件（awakening 和 chat 阶段都需要）
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

    const flushPendingThinkingSeed = (sessionId: string) => {
      if (
        activeBlockTypeRef.current !== "thinking" ||
        activeThinkingHasDeltaRef.current ||
        pendingThinkingSeedRef.current.length === 0
      ) {
        resetThinkingStreamState();
        return;
      }

      appendThinking(sessionId, pendingThinkingSeedRef.current);
      resetThinkingStreamState();
    };

    const unsubscribe = zora.onStream((streamEvent) => {
      const eventSessionId = streamEvent.sessionId;
      const currentSessionId = store.get(currentSessionIdAtom);
      const activeMessageSessionId =
        appPhaseRef.current.startsWith("awakening") ? "__awakening__" : currentSessionId;
      const isCurrentSessionEvent = eventSessionId === activeMessageSessionId;
      const targetSessionId = eventSessionId ?? activeMessageSessionId;

      console.log(`[renderer event][mode:${appPhaseRef.current}]`, JSON.stringify(streamEvent).slice(0, 500));

      // ─── HITL 事件分发 ───
      if (streamEvent.type === "permission_request" && "request" in streamEvent) {
        const request = streamEvent.request as PermissionRequest;
        console.log("[renderer][hitl] Received permission_request.", {
          requestId: request.requestId,
          toolName: request.toolName,
          description: request.description,
        });
        if (targetSessionId) {
          pushPermission({ request, sessionId: targetSessionId });
        }
        return;
      }
      if (streamEvent.type === "permission_resolved" && "requestId" in streamEvent) {
        console.log("[renderer][hitl] Received permission_resolved.", {
          requestId: streamEvent.requestId,
        });
        resolvePermission(streamEvent.requestId as string);
        return;
      }
      if (streamEvent.type === "ask_user_request" && "request" in streamEvent) {
        const request = streamEvent.request as AskUserRequest;
        console.log("[renderer][hitl] Received ask_user_request.", {
          requestId: request.requestId,
          questionCount: request.questions.length,
        });
        if (targetSessionId) {
          pushAskUser({ request, sessionId: targetSessionId });
        }
        return;
      }
      if (streamEvent.type === "ask_user_resolved" && "requestId" in streamEvent) {
        console.log("[renderer][hitl] Received ask_user_resolved.", {
          requestId: streamEvent.requestId,
        });
        resolveAskUser(streamEvent.requestId as string);
        return;
      }

      if (streamEvent.type === "agent_error") {
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
            setSessionRunning(eventSessionId, true);
          }

          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
          return;
        }

        if (streamEvent.status === "finished") {
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
          console.log("[renderer][tool] tool_use started.", {
            sessionId: targetSessionId,
            toolName: chunks.blockStart.toolName,
            toolUseId: chunks.blockStart.toolUseId,
            initialInput: chunks.blockStart.toolInput,
          });
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
            pendingThinkingSeedRef.current = chunks.blockStart.thinking ?? "";
            activeThinkingHasDeltaRef.current = false;
            addThinkingStep(targetSessionId, "");
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
          appendThinking(
            targetSessionId,
            mergeThinkingSeedWithDelta(
              pendingThinkingSeedRef.current,
              chunks.thinkingDelta
            )
          );
          pendingThinkingSeedRef.current = "";
        } else {
          appendThinking(targetSessionId, chunks.thinkingDelta);
        }
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.toolInputDelta) {
        console.log("[renderer][tool] tool_use input delta.", {
          sessionId: targetSessionId,
          chunkLength: chunks.toolInputDelta.length,
          chunkPreview: chunks.toolInputDelta.slice(0, 120),
        });
        appendToolInput(targetSessionId, chunks.toolInputDelta);
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (
        streamEvent.type === "stream_event" &&
        isRecord(streamEvent.event) &&
        streamEvent.event.type === "content_block_stop"
      ) {
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
    clearHitlForSession
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

  return (
    <AppShell />
  );
}
