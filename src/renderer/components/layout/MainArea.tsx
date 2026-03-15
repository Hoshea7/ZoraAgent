import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  clearDraftAttachmentsAtom,
  draftAttachmentsAtom,
  startConversationAtom,
  failConversationAtom,
  draftAtom,
} from "../../store/chat";
import {
  currentSessionIdAtom,
  createSessionAtom,
  touchSessionAtom
} from "../../store/workspace";
import { generateSmartTitle } from "../../utils/title";
import { getErrorMessage } from "../../utils/message";
import { ChatHeader } from "../chat/ChatHeader";
import { MessageList } from "../chat/MessageList";
import { ChatInput } from "../chat/ChatInput";
import { PermissionBanner } from "../chat/PermissionBanner";
import { AskUserBanner } from "../chat/AskUserBanner";

export function MainArea() {
  const startConversation = useSetAtom(startConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);
  const clearAttachments = useSetAtom(clearDraftAttachmentsAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const attachments = useAtomValue(draftAttachmentsAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const touchSession = useSetAtom(touchSessionAtom);

  const handleSubmit = async () => {
    const text = draft.trim();
    const currentAttachments = attachments;

    if (!text && currentAttachments.length === 0) {
      return;
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await createSession(
        generateSmartTitle(text || currentAttachments[0]?.name || "新会话")
      );
    }

    if (!sessionId) {
      return;
    }

    const chatText = text || "我发送了一些附件。";

    startConversation(text, currentAttachments);
    touchSession(sessionId);
    setDraft("");
    clearAttachments();

    try {
      await window.zora.chat(chatText, sessionId);
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
