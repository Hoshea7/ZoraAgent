import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  startAssistantMessageForSessionAtom,
  appendAssistantTextForSessionAtom,
  appendAssistantThinkingForSessionAtom,
  appendToolInputForSessionAtom,
  completeStreamingMessageForSessionAtom,
  completeToolResultForSessionAtom,
  hydrateAssistantForSessionAtom,
  completeConversationForSessionAtom,
  failConversationForSessionAtom,
  startToolUseForSessionAtom,
  isAgentIdleAtom,
  messagesAtom,
  setSessionRunningAtom
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
  extractAssistantPayload,
  extractToolResultContent,
  getAgentErrorText,
  isRecord
} from "./utils/message";
import { AppShell } from "./components/layout/AppShell";
import { AwakeningDialogue } from "./components/awakening/AwakeningDialogue";
import { AwakeningCanvas } from "./components/awakening/AwakeningCanvas";
import { AwakeningComplete } from "./components/awakening/AwakeningComplete";

/**
 * 应用根组件
 * 管理 App 生命周期阶段（splash → awakening → chat）
 * 负责初始化和流式事件处理
 */
export default function App() {
  const appPhase = useAtomValue(appPhaseAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const appPhaseRef = useRef(appPhase);
  const toolInputBufferRef = useRef(new Map<string, string>());
  const toolInputFlushTimerRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const store = useStore();
  const checkAwakening = useSetAtom(checkAwakeningAtom);
  const completeAwakening = useSetAtom(completeAwakeningAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const setMessages = useSetAtom(messagesAtom);

  const startAssistantMessage = useSetAtom(startAssistantMessageForSessionAtom);
  const appendAssistantText = useSetAtom(appendAssistantTextForSessionAtom);
  const appendAssistantThinking = useSetAtom(appendAssistantThinkingForSessionAtom);
  const appendToolInput = useSetAtom(appendToolInputForSessionAtom);
  const completeStreamingMessage = useSetAtom(completeStreamingMessageForSessionAtom);
  const completeToolResult = useSetAtom(completeToolResultForSessionAtom);
  const hydrateAssistant = useSetAtom(hydrateAssistantForSessionAtom);
  const completeConversation = useSetAtom(completeConversationForSessionAtom);
  const failConversation = useSetAtom(failConversationForSessionAtom);
  const startToolUse = useSetAtom(startToolUseForSessionAtom);
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

  useEffect(() => {
    if (appPhase !== "chat" || !currentSessionId) {
      return;
    }

    let cancelled = false;

    void window.zora
      .isAgentRunning(currentSessionId)
      .then((isRunning) => {
        if (cancelled) {
          return;
        }

        setSessionRunning(currentSessionId, isRunning);
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

      appendToolInput(targetSessionIdFromFlush(sessionId), pending);
    };

    const targetSessionIdFromFlush = (sessionId: string) => sessionId;

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
      const currentSessionId = store.get(currentSessionIdAtom);
      const activeMessageSessionId =
        appPhaseRef.current.startsWith("awakening") ? "__awakening__" : currentSessionId;
      const isCurrentSessionEvent = eventSessionId === activeMessageSessionId;
      const targetSessionId = eventSessionId ?? activeMessageSessionId;

      console.log(`[renderer event][mode:${appPhaseRef.current}]`, streamEvent);

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
        flushAllToolInput();

        if (eventSessionId) {
          setSessionRunning(eventSessionId, false);
        }

        if (targetSessionId) {
          failConversation(
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
          flushAllToolInput();

          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
          }

          if (targetSessionId) {
            completeConversation(targetSessionId, "done");
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

          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
          }

          if (targetSessionId) {
            completeConversation(targetSessionId, "stopped");
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
        flushToolInput(targetSessionId);
        hydrateAssistant(targetSessionId, extractAssistantPayload(streamEvent.message));
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
        return;
      }

      if (streamEvent.type === "result") {
        flushToolInput(targetSessionId);
        completeConversation(targetSessionId, "done");
        if (isCurrentSessionEvent) {
          clearIdleTimer();
          setIsAgentIdle(false);
        }
        return;
      }

      const chunks = extractStreamChunks(streamEvent);
      if (chunks.blockStart) {
        if (chunks.blockStart.type === "tool_use") {
          console.log("[renderer][tool] tool_use started.", {
            sessionId: targetSessionId,
            toolName: chunks.blockStart.toolName,
            toolUseId: chunks.blockStart.toolUseId,
            initialInput: chunks.blockStart.toolInput,
          });
          startToolUse(
            targetSessionId,
            chunks.blockStart.toolName,
            chunks.blockStart.toolUseId,
            chunks.blockStart.toolInput
          );
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        } else {
          startAssistantMessage(targetSessionId, chunks.blockStart);
          if (isCurrentSessionEvent) {
            bumpContentActivity();
          }
        }
      }

      if (chunks.textDelta) {
        appendAssistantText(targetSessionId, chunks.textDelta);
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
      }

      if (chunks.thinkingDelta) {
        appendAssistantThinking(targetSessionId, chunks.thinkingDelta);
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
        completeStreamingMessage(targetSessionId);
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
    startAssistantMessage,
    appendAssistantText,
    appendAssistantThinking,
    appendToolInput,
    completeConversation,
    completeStreamingMessage,
    completeToolResult,
    failConversation,
    hydrateAssistant,
    startToolUse,
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
