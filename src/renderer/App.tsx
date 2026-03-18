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

function describeStreamEvent(streamEvent: Record<string, unknown>) {
  const summary: Record<string, unknown> = {
    type: streamEvent.type,
    sessionId: streamEvent.sessionId ?? null,
  };

  if (streamEvent.type === "stream_event" && isRecord(streamEvent.event)) {
    const event = streamEvent.event;
    summary.eventType = event.type;

    if (event.type === "content_block_start" && isRecord(event.content_block)) {
      summary.blockType = event.content_block.type;

      if (event.content_block.type === "tool_use") {
        summary.toolName = event.content_block.name;
        summary.toolUseId = event.content_block.id;
      }
    }

    if (event.type === "content_block_delta" && isRecord(event.delta)) {
      summary.deltaType = event.delta.type;

      if (typeof event.delta.text === "string") {
        summary.textLength = event.delta.text.length;
      }

      if (typeof event.delta.thinking === "string") {
        summary.thinkingLength = event.delta.thinking.length;
      }

      if (typeof event.delta.partial_json === "string") {
        summary.partialJsonLength = event.delta.partial_json.length;
      }
    }

    return summary;
  }

  if (streamEvent.type === "user" && isRecord(streamEvent.message)) {
    const content = Array.isArray(streamEvent.message.content) ? streamEvent.message.content : [];
    const toolUseIds = content
      .filter(
        (block): block is Record<string, unknown> =>
          isRecord(block) &&
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string"
      )
      .map((block) => block.tool_use_id);

    if (toolUseIds.length > 0) {
      summary.toolResultCount = toolUseIds.length;
      summary.toolUseIds = toolUseIds;
    }

    return summary;
  }

  if (streamEvent.type === "assistant" && isRecord(streamEvent.message)) {
    const firstBlock = Array.isArray(streamEvent.message.content)
      ? streamEvent.message.content[0]
      : null;

    if (isRecord(firstBlock)) {
      summary.blockType = firstBlock.type;

      if (firstBlock.type === "tool_use") {
        summary.toolName = firstBlock.name;
        summary.toolUseId = firstBlock.id;
      }
    }
  }

  if (streamEvent.type === "permission_request" && isRecord(streamEvent.request)) {
    summary.toolName = streamEvent.request.toolName;
    summary.requestId = streamEvent.request.requestId;
  }

  return summary;
}

/**
 * 应用根组件
 * 管理 App 生命周期阶段（splash → awakening → chat）
 * 负责初始化和流式事件处理
 */
export default function App() {
  const appPhase = useAtomValue(appPhaseAtom);
  const appPhaseRef = useRef(appPhase);
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
        appPhaseRef.current.startsWith("awakening") ? "__awakening__" : currentSessionId;
      const isCurrentSessionEvent = eventSessionId === activeMessageSessionId;
      const targetSessionId = eventSessionId ?? activeMessageSessionId;

      console.log(
        `[renderer event][mode:${appPhaseRef.current}]`,
        describeStreamEvent(streamEvent as Record<string, unknown>)
      );

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
