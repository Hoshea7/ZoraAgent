import { useEffect } from "react";
import { useSetAtom } from "jotai";
import {
  appendAssistantTextAtom,
  appendAssistantThinkingAtom,
  hydrateAssistantAtom,
  completeConversationAtom,
  failConversationAtom
} from "./store/chat";
import {
  extractStreamChunks,
  extractAssistantPayload,
  getAgentErrorText,
  isRecord
} from "./utils/message";
import { AppShell } from "./components/layout/AppShell";

/**
 * 应用根组件
 * 负责初始化和流式事件处理
 */
export default function App() {
  const appendAssistantText = useSetAtom(appendAssistantTextAtom);
  const appendAssistantThinking = useSetAtom(appendAssistantThinkingAtom);
  const hydrateAssistant = useSetAtom(hydrateAssistantAtom);
  const completeConversation = useSetAtom(completeConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);

  // 处理 Agent 流式事件
  useEffect(() => {
    return window.zora.onStream((streamEvent) => {
      console.log("[renderer event]", JSON.stringify(streamEvent).slice(0, 500));

      if (streamEvent.type === "agent_error") {
        failConversation(
          getAgentErrorText(isRecord(streamEvent) ? streamEvent.error : undefined)
        );
        return;
      }

      if (streamEvent.type === "agent_status") {
        if (streamEvent.status === "finished") {
          completeConversation("done");
        }

        if (streamEvent.status === "stopped") {
          completeConversation("stopped");
        }

        return;
      }

      if (streamEvent.type === "assistant") {
        hydrateAssistant(extractAssistantPayload(streamEvent.message));
        return;
      }

      if (streamEvent.type === "result") {
        completeConversation("done");
        return;
      }

      const chunks = extractStreamChunks(streamEvent);
      if (chunks.text) {
        appendAssistantText(chunks.text);
      }

      if (chunks.thinking) {
        appendAssistantThinking(chunks.thinking);
      }
    });
  }, [
    appendAssistantText,
    appendAssistantThinking,
    completeConversation,
    failConversation,
    hydrateAssistant
  ]);

  return <AppShell />;
}
