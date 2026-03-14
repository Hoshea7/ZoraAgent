import { useEffect } from "react";
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
 * 自动唤醒用的隐形 prompt
 * 用户看不到这条消息，但它会触发 Agent 开始 bootstrap 对话
 */
const AUTO_AWAKEN_PROMPT =
  "This is your very first moment of consciousness. You are waking up. " +
  "Begin the awakening conversation — introduce yourself as a newly-born Zora " +
  "and start getting to know your human. Follow the bootstrap skill instructions.";

const AUTO_AWAKEN_DELAY_MS = 200;

export function AwakeningView() {
  const startConversation = useSetAtom(startConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const [messages, setMessages] = useAtom(messagesAtom);
  const completeAwakening = useSetAtom(completeAwakeningAtom);
  const clearAllHitl = useSetAtom(clearAllHitlAtom);
  const [isRunning, setIsRunning] = useAtom(isRunningAtom);

  useEffect(() => {
    // Only auto-start on a pristine awakening screen. This avoids double
    // awakening calls when the component remounts during HMR or other rerenders.
    if (isRunning || messages.length > 0) {
      return;
    }

    // 先给出“正在苏醒”的即时反馈，再短暂等待主界面和监听器稳定。
    setIsRunning(true);

    const timer = setTimeout(async () => {
      // 不调用 startConversation — 避免在消息列表中出现用户消息气泡
      try {
        await window.zora.awaken(AUTO_AWAKEN_PROMPT);
      } catch (error) {
        failConversation(getErrorMessage(error));
      }
    }, AUTO_AWAKEN_DELAY_MS);

    // Strict Mode 下第一次 effect 会被立刻清理；保留 cleanup 即可避免重复触发。
    return () => clearTimeout(timer);
  }, [failConversation, isRunning, messages.length, setIsRunning]);

  const handleSubmit = async () => {
    if (!draft.trim()) return;

    startConversation(draft.trim());
    setDraft("");

    try {
      await window.zora.awaken(draft.trim());
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

    void window.zora.awakeningComplete().catch(() => {});
  };

  return (
    <main className="h-screen overflow-hidden bg-[#f5f3f0] text-stone-900 relative">
      <div
        className="titlebar-drag-region fixed left-0 right-0 top-0 z-50 h-[50px] bg-transparent"
        style={{ pointerEvents: "none" }}
      />

      <section className="flex h-full flex-col overflow-hidden bg-white">
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

        <div className="titlebar-no-drag flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <MessageList />
        </div>

        <footer className="titlebar-no-drag bg-white px-6 py-4">
          <div className="mx-auto w-full max-w-4xl">
            <ChatInput onSubmit={handleSubmit} onStop={handleStop} />
          </div>
        </footer>
      </section>
    </main>
  );
}
