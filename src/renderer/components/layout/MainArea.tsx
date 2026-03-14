import { useAtom, useSetAtom } from "jotai";
import {
  startConversationAtom,
  failConversationAtom,
  draftAtom,
  isRunningAtom,
  messagesAtom
} from "../../store/chat";
import {
  currentSessionIdAtom,
  createSessionAtom
} from "../../store/workspace";
import { getErrorMessage } from "../../utils/message";
import { ChatHeader } from "../chat/ChatHeader";
import { MessageList } from "../chat/MessageList";
import { ChatInput } from "../chat/ChatInput";
import { PermissionBanner } from "../chat/PermissionBanner";
import { AskUserBanner } from "../chat/AskUserBanner";

export function MainArea() {
  const startConversation = useSetAtom(startConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const setIsRunning = useSetAtom(isRunningAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const [messages] = useAtom(messagesAtom);

  const handleSubmit = async () => {
    if (!draft.trim()) return;

    // 首条消息时创建会话，标题取消息前 20 字
    if (!currentSessionId && messages.length === 0) {
      const title = draft.length > 20 ? `${draft.slice(0, 20)}...` : draft;
      createSession(title);
    }

    startConversation(draft.trim());
    setDraft("");

    try {
      await window.zora.chat(draft.trim());
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
    <section className="flex h-full flex-col overflow-hidden bg-white">
      <ChatHeader />

      <div className="titlebar-no-drag flex-1 overflow-hidden">
        <MessageList />
      </div>

      <footer className="titlebar-no-drag shrink-0 bg-white px-6 py-4">
        <div className="mx-auto w-full max-w-4xl">
          <PermissionBanner />
          <AskUserBanner />
          <ChatInput onSubmit={handleSubmit} onStop={handleStop} />
        </div>
      </footer>
    </section>
  );
}
