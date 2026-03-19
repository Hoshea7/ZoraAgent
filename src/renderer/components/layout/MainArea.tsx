import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  clearDraftAttachmentsAtom,
  draftAttachmentsAtom,
  startConversationAtom,
  failTurnAtom,
  draftAtom,
  setSessionRunningAtom,
} from "../../store/chat";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  createSessionAtom,
  touchSessionAtom,
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
  const failTurn = useSetAtom(failTurnAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const clearAttachments = useSetAtom(clearDraftAttachmentsAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const attachments = useAtomValue(draftAttachmentsAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const [currentWorkspaceId] = useAtom(currentWorkspaceIdAtom);
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
      await window.zora.chat(
        chatText,
        sessionId,
        currentWorkspaceId,
        currentAttachments.length > 0 ? currentAttachments : undefined
      );
    } catch (error) {
      const message = getErrorMessage(error);

      if (message.includes("An agent is already running for session")) {
        setSessionRunning(sessionId, true);
        failTurn(
          sessionId,
          "当前会话里还有一个 Agent 在运行，请先等待它结束，或点击停止按钮终止后再继续。"
        );
        return;
      }

      failTurn(sessionId, message);
    }
  };

  const handleStop = async () => {
    if (!currentSessionId) {
      return;
    }

    try {
      await window.zora.stopAgent(currentSessionId);
    } catch (error) {
      failTurn(currentSessionId, getErrorMessage(error));
    }
  };

  return (
    <section className="flex h-full flex-col overflow-hidden bg-white">
      <ChatHeader />

      <div className="titlebar-no-drag flex-1 overflow-hidden">
        <MessageList />
      </div>

      <footer className="titlebar-no-drag shrink-0 bg-white px-5 py-4 sm:px-8">
        <div className="mx-auto w-full max-w-[920px]">
          <PermissionBanner />
          <AskUserBanner />
          <ChatInput onSubmit={handleSubmit} onStop={handleStop} />
        </div>
      </footer>
    </section>
  );
}
