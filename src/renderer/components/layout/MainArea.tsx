import { useSetAtom } from "jotai";
import {
  startConversationAtom,
  failConversationAtom,
  draftAtom,
  isRunningAtom
} from "../../store/chat";
import { getErrorMessage } from "../../utils/message";
import { ChatHeader } from "../chat/ChatHeader";
import { MessageList } from "../chat/MessageList";
import { ChatInput } from "../chat/ChatInput";

/**
 * 主对话区域组件
 * 包含标题栏、消息列表和输入框
 */
export function MainArea() {
  const startConversation = useSetAtom(startConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);
  const setDraft = useSetAtom(draftAtom);
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

  return (
    <section className="titlebar-no-drag flex h-full flex-col overflow-hidden rounded-[30px] border border-stone-900/10 bg-[linear-gradient(180deg,_rgba(255,253,249,0.95)_0%,_rgba(249,241,230,0.94)_100%)] shadow-[0_30px_100px_rgba(90,55,28,0.14)]">
      <ChatHeader />

      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <MessageList />
      </div>

      <footer className="border-t border-stone-900/8 bg-white/55 px-4 py-4 sm:px-6">
        <ChatInput onSubmit={handleSubmit} onStop={handleStop} />
      </footer>
    </section>
  );
}
