import { useAtom, useSetAtom } from "jotai";
import {
  startConversationAtom,
  failConversationAtom,
  draftAtom,
  isRunningAtom,
  messagesAtom,
} from "../../store/chat";
import { completeAwakeningAtom } from "../../store/zora";
import { clearAllHitlAtom } from "../../store/hitl";
import { getErrorMessage } from "../../utils/message";
import { MessageList } from "../chat/MessageList";
import { ChatInput } from "../chat/ChatInput";
import { Button } from "../ui/Button";

/**
 * 唤醒阶段对话界面
 * 复用现有的 MessageList 和 ChatInput，但不渲染侧边栏
 * 3A 阶段只做骨架，3B 再做沉浸式体验
 */
export function AwakeningView() {
  const startConversation = useSetAtom(startConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);
  const setDraft = useSetAtom(draftAtom);
  const setMessages = useSetAtom(messagesAtom);
  const completeAwakening = useSetAtom(completeAwakeningAtom);
  const clearAllHitl = useSetAtom(clearAllHitlAtom);
  const [isRunning] = useAtom(isRunningAtom);
  const setIsRunning = useSetAtom(isRunningAtom);

  const handleSubmit = async () => {
    const draft = document.querySelector<HTMLTextAreaElement>("textarea")?.value.trim();
    if (!draft) return;

    startConversation(draft);
    setDraft("");

    try {
      await window.zora.chat(draft);
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  };

  const handleStop = async () => {
    setIsRunning(false);

    try {
      await window.zora.stopAgent();
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  };

  const handleSkip = () => {
    setDraft("");
    setMessages([]);
    clearAllHitl();
    setIsRunning(false);
    completeAwakening();

    if (isRunning) {
      void window.zora.stopAgent().catch((error) => {
        console.warn("[awakening] Failed to stop agent while skipping.", error);
      });
    }
  };

  return (
    <main className="h-screen overflow-hidden bg-[#f5f3f0] text-stone-900 relative">
      {/* macOS 拖动区域 */}
      <div
        className="titlebar-drag-region fixed left-0 right-0 top-0 z-50 h-[50px] bg-transparent"
        style={{ pointerEvents: "none" }}
      />

      <section className="flex h-full flex-col overflow-hidden bg-white">
        {/* 简易顶栏 */}
        <header className="titlebar-drag-region relative flex h-[50px] shrink-0 items-center justify-center border-b border-stone-100">
          <span className="text-sm font-medium text-stone-500">
            {isRunning ? "Zora is awakening..." : "Awakening"}
          </span>
          <div className="titlebar-no-drag absolute right-4 top-1/2 -translate-y-1/2">
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              跳过
            </Button>
          </div>
        </header>

        {/* 消息展示区 */}
        <div className="titlebar-no-drag flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <MessageList />
        </div>

        {/* 输入框 */}
        <footer className="titlebar-no-drag bg-white px-6 py-4">
          <div className="mx-auto w-full max-w-4xl">
            <ChatInput onSubmit={handleSubmit} onStop={handleStop} />
          </div>
        </footer>
      </section>
    </main>
  );
}
