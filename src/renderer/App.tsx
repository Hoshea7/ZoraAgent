import { useEffect } from "react";
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
  clearAllHitlAtom,
} from "./store/hitl";
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
import { AwakeningView } from "./components/awakening/AwakeningView";

/**
 * 应用根组件
 * 管理 App 生命周期阶段（splash → awakening → chat）
 * 负责初始化和流式事件处理
 */
export default function App() {
  const appPhase = useAtomValue(appPhaseAtom);
  const store = useStore();
  const checkAwakening = useSetAtom(checkAwakeningAtom);
  const completeAwakening = useSetAtom(completeAwakeningAtom);
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
  const clearAllHitl = useSetAtom(clearAllHitlAtom);

  // 启动阶段：检查唤醒状态
  useEffect(() => {
    checkAwakening();
  }, [checkAwakening]);

  useEffect(() => {
    console.log(`[app] Current mode: ${appPhase}`);
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

    const unsubscribe = zora.onStream((streamEvent) => {
      const eventSessionId = streamEvent.sessionId;
      const currentSessionId = store.get(currentSessionIdAtom);
      const activeMessageSessionId =
        appPhase === "awakening" ? "__awakening__" : currentSessionId;
      const isCurrentSessionEvent = eventSessionId === activeMessageSessionId;
      const targetSessionId = eventSessionId ?? activeMessageSessionId;

      console.log(`[renderer event][mode:${appPhase}]`, JSON.stringify(streamEvent).slice(0, 500));

      // ─── HITL 事件分发 ───
      if (streamEvent.type === "permission_request" && "request" in streamEvent) {
        pushPermission(streamEvent.request as PermissionRequest);
        return;
      }
      if (streamEvent.type === "permission_resolved" && "requestId" in streamEvent) {
        resolvePermission(streamEvent.requestId as string);
        return;
      }
      if (streamEvent.type === "ask_user_request" && "request" in streamEvent) {
        pushAskUser(streamEvent.request as AskUserRequest);
        return;
      }
      if (streamEvent.type === "ask_user_resolved" && "requestId" in streamEvent) {
        resolveAskUser(streamEvent.requestId as string);
        return;
      }

      if (streamEvent.type === "agent_error") {
        if (eventSessionId) {
          setSessionRunning(eventSessionId, false);
        }

        if (targetSessionId) {
          failConversation(
            targetSessionId,
            getAgentErrorText(isRecord(streamEvent) ? streamEvent.error : undefined)
          );
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
          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
          }

          if (targetSessionId) {
            completeConversation(targetSessionId, "done");
          }

          if (isCurrentSessionEvent) {
            clearIdleTimer();
            setIsAgentIdle(false);
            clearAllHitl();
          }

          if (appPhase === "awakening" && isCurrentSessionEvent) {
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
          if (eventSessionId) {
            setSessionRunning(eventSessionId, false);
          }

          if (targetSessionId) {
            completeConversation(targetSessionId, "stopped");
          }

          if (isCurrentSessionEvent) {
            clearIdleTimer();
            setIsAgentIdle(false);
            clearAllHitl();
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
        hydrateAssistant(targetSessionId, extractAssistantPayload(streamEvent.message));
        if (isCurrentSessionEvent) {
          bumpContentActivity();
        }
        return;
      }

      if (streamEvent.type === "result") {
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
        completeStreamingMessage(targetSessionId);
      }
    });

    return () => {
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
    appPhase,
    store,
    completeAwakening,
    setMessages,
    setSessionRunning,
    pushPermission,
    resolvePermission,
    pushAskUser,
    resolveAskUser,
    clearAllHitl
  ]);

  if (appPhase === "splash") {
    return null;
  }

  if (appPhase === "awakening") {
    return <AwakeningView />;
  }

  return <AppShell />;
}
