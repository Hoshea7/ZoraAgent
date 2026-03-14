import { useAtom, useSetAtom } from "jotai";
import {
  startConversationAtom,
  failConversationAtom,
  draftAtom,
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
  const setDraft = useSetAtom(draftAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);

  const handleSubmit = async () => {
    const text = document.querySelector<HTMLTextAreaElement>("textarea")?.value.trim();
    if (!text) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      const title = text.length > 20 ? `${text.slice(0, 20)}...` : text;
      sessionId = await createSession(title);
    }

    if (!sessionId) {
      return;
    }

    startConversation(text);
    setDraft("");

    try {
      await window.zora.chat(text, sessionId);
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  };

  const handleStop = async () => {
    if (!currentSessionId) {
      return;
    }

    try {
      await window.zora.stopAgent(currentSessionId);
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  };

  return (
    <section className="flex h-full flex-col overflow-hidden bg-white">
      <ChatHeader />

      <div className="titlebar-no-drag flex-1 overflow-y-auto px-5 py-5 sm:px-8">
        <MessageList />
      </div>

      <footer className="titlebar-no-drag bg-white px-6 py-4">
        <div className="mx-auto w-full max-w-4xl">
          <PermissionBanner />
          <AskUserBanner />
          <ChatInput onSubmit={handleSubmit} onStop={handleStop} />
        </div>
      </footer>
    </section>
  );
}
