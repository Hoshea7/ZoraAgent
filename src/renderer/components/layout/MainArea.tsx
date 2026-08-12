import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  clearDraftAttachmentsAtom,
  draftAttachmentsAtom,
  messagesAtom,
  startConversationAtom,
  queueConversationAtom,
  failTurnAtom,
  draftAtom,
  setSessionRunningAtom,
} from "../../store/chat";
import { providersAtom } from "../../store/provider";
import {
  currentSessionAtom,
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  createSessionAtom,
  draftAgentRuntimeTypeAtom,
  draftReasoningLevelAtom,
  draftSelectedProviderIdAtom,
  draftSelectedModelIdAtom,
  touchSessionAtom,
  setDraftSelectedProviderIdAtom,
  setDraftSelectedModelIdAtom,
  setDraftAgentRuntimeTypeAtom,
  setDraftReasoningLevelAtom,
  updateSessionMetaInStateAtom,
} from "../../store/workspace";
import { defaultModelSettingsAtom } from "../../store/default-model";
import {
  normalizeOptionalModelId,
  resolveCurrentProviderAndModel,
  resolveSelectedModelOverride,
} from "../../utils/provider-selection";
import { generateSmartTitle } from "../../utils/title";
import { getErrorMessage } from "../../utils/message";
import {
  logChatSubmitStart,
  logCurrentSessionMissing,
} from "../../utils/client-log";
import { ChatHeader } from "../chat/ChatHeader";
import { MessageList } from "../chat/MessageList";
import { ChatInput } from "../chat/ChatInput";
import { PermissionBanner } from "../chat/PermissionBanner";
import { AskUserBanner } from "../chat/AskUserBanner";
import { EmptyState } from "../chat/EmptyState";

function createQueueMessageUuid() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function MainArea() {
  const startConversation = useSetAtom(startConversationAtom);
  const queueConversation = useSetAtom(queueConversationAtom);
  const failTurn = useSetAtom(failTurnAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const clearAttachments = useSetAtom(clearDraftAttachmentsAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const messages = useAtomValue(messagesAtom);
  const attachments = useAtomValue(draftAttachmentsAtom);
  const providers = useAtomValue(providersAtom);
  const defaultModelSettings = useAtomValue(defaultModelSettingsAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const draftSelectedProviderId = useAtomValue(draftSelectedProviderIdAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const draftAgentRuntimeType = useAtomValue(draftAgentRuntimeTypeAtom);
  const draftReasoningLevel = useAtomValue(draftReasoningLevelAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const [currentWorkspaceId] = useAtom(currentWorkspaceIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const touchSession = useSetAtom(touchSessionAtom);
  const setDraftSelectedProviderId = useSetAtom(setDraftSelectedProviderIdAtom);
  const setDraftSelectedModelId = useSetAtom(setDraftSelectedModelIdAtom);
  const setDraftAgentRuntimeType = useSetAtom(setDraftAgentRuntimeTypeAtom);
  const setDraftReasoningLevel = useSetAtom(setDraftReasoningLevelAtom);
  const updateSessionMetaInState = useSetAtom(updateSessionMetaInStateAtom);
  const isEmptyConversation = messages.length === 0;

  const handleSubmit = async () => {
    const text = draft.trim();
    const currentAttachments = attachments;

    if (!text && currentAttachments.length === 0) {
      return;
    }

    const activeSession =
      currentSessionId && currentSession ? currentSession : null;
    const staleSessionId =
      currentSessionId && !currentSession ? currentSessionId : null;

    if (staleSessionId) {
      logCurrentSessionMissing({
        currentSessionId: staleSessionId,
        currentWorkspaceId,
        inputLength: text.length,
        attachmentCount: currentAttachments.length,
      });
    }

    let effectiveDefaultModelSettings = defaultModelSettings;
    if (
      !effectiveDefaultModelSettings &&
      !draftSelectedProviderId &&
      !draftSelectedModelId
    ) {
      try {
        effectiveDefaultModelSettings = await window.zora.defaultModel.getSettings();
      } catch {
        // Fall back to the active provider when settings cannot be loaded in time.
      }
    }

    const {
      provider: selectedProvider,
      modelId: selectedModelId,
      isMissingLockedProvider,
    } = resolveCurrentProviderAndModel(
      providers,
      activeSession,
      effectiveDefaultModelSettings,
      draftSelectedProviderId,
      draftSelectedModelId
    );

    if (isMissingLockedProvider) {
      if (currentSessionId) {
        failTurn(currentSessionId, "此会话绑定的 Provider 已被删除，请创建新会话。");
      }
      return;
    }

    logChatSubmitStart({
      currentSessionId,
      currentSessionExists: Boolean(activeSession),
      currentWorkspaceId,
      selectedProvider: selectedProvider?.name ?? null,
      selectedProviderType: selectedProvider?.providerType ?? null,
      selectedModel: selectedModelId ?? null,
      selectionSource: activeSession?.providerLocked
        ? "session"
        : draftSelectedProviderId || draftSelectedModelId
          ? "composer"
          : selectedProvider
            ? "default"
            : "none",
      attachmentCount: currentAttachments.length,
      inputLength: text.length,
    });

    let sessionId = activeSession ? currentSessionId : null;
    if (!sessionId) {
      sessionId = await createSession(
        generateSmartTitle(text || currentAttachments[0]?.name || "新会话")
      );
    }

    if (!sessionId) {
      return;
    }

    const nextSelectedModelOverride = (
      activeSession?.parentSessionId
        ? normalizeOptionalModelId(activeSession.selectedModelId) ?? selectedModelId
        : resolveSelectedModelOverride(selectedProvider, selectedModelId)
    ) ?? "";
    const modelLogContext = selectedProvider
      ? {
          provider: selectedProvider.name,
          providerType: selectedProvider.providerType,
          model: selectedModelId,
          selectionSource: nextSelectedModelOverride
            ? ("selected" as const)
            : ("provider_default" as const),
        }
      : undefined;
    const currentSelectedModelOverride =
      normalizeOptionalModelId(activeSession?.selectedModelId) ?? "";

    try {
      if (selectedProvider?.id) {
        await window.zora.lockSessionModel(
          sessionId,
          selectedProvider.id,
          nextSelectedModelOverride,
          currentWorkspaceId,
          modelLogContext
        );
      } else if (
        activeSession === null ||
        currentSelectedModelOverride !== nextSelectedModelOverride
      ) {
        await window.zora.switchSessionModel(
          sessionId,
          nextSelectedModelOverride,
          currentWorkspaceId,
          modelLogContext
        );
      }

      if (activeSession === null) {
        await window.zora.setSessionRuntime(
          sessionId,
          draftAgentRuntimeType,
          currentWorkspaceId
        );
        await window.zora.setSessionReasoningLevel(
          sessionId,
          draftReasoningLevel,
          currentWorkspaceId
        );
      }
    } catch (error) {
      failTurn(sessionId, getErrorMessage(error));
      return;
    }

    updateSessionMetaInState({
      sessionId,
      updates: {
        providerId: activeSession?.providerId ?? selectedProvider?.id,
        providerLocked:
          activeSession?.providerLocked === true || Boolean(selectedProvider),
        selectedModelId: nextSelectedModelOverride || undefined,
        agentRuntimeType: activeSession?.agentRuntimeType ?? draftAgentRuntimeType,
        reasoningLevel: activeSession?.reasoningLevel ?? draftReasoningLevel,
      },
    });
    setDraftSelectedProviderId(undefined);
    setDraftSelectedModelId(undefined);
    setDraftAgentRuntimeType("pi");
    setDraftReasoningLevel("high");

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
      throw error;
    }
  };

  const handleQueueMessage = async () => {
    const text = draft.trim();
    const sessionId = currentSessionId;
    const currentAttachments = attachments;

    if ((!text && currentAttachments.length === 0) || !sessionId) {
      return;
    }

    const messageUuid = createQueueMessageUuid();
    const queuedText = text || "我发送了一些附件。";

    queueConversation(sessionId, text, messageUuid, currentAttachments);
    touchSession(sessionId);
    setDraft("");
    clearAttachments();

    try {
      await window.zora.queueMessage(
        sessionId,
        queuedText,
        currentWorkspaceId,
        messageUuid,
        currentAttachments.length > 0 ? currentAttachments : undefined
      );
    } catch (error) {
      console.error("[chat] Queue message failed:", error);
    }
  };

  return (
    <section className="flex h-full flex-col overflow-hidden bg-white">
      <ChatHeader />

      {isEmptyConversation ? (
        <div className="titlebar-no-drag min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 sm:px-8">
          <div className="mx-auto flex min-h-full w-full max-w-[720px] items-center justify-center py-8">
            <div className="w-full -translate-y-[2vh]">
              <EmptyState />
              <div className="mt-7 w-full">
                <PermissionBanner />
                <AskUserBanner />
                <ChatInput
                  onSubmit={handleSubmit}
                  onQueueMessage={handleQueueMessage}
                  onStop={handleStop}
                  variant="hero"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="titlebar-no-drag flex-1 overflow-hidden">
            <MessageList />
          </div>

          <footer className="titlebar-no-drag shrink-0 bg-white px-5 py-4 sm:px-8">
            <div className="mx-auto w-full max-w-[920px]">
              <PermissionBanner />
              <AskUserBanner />
              <ChatInput
                onSubmit={handleSubmit}
                onQueueMessage={handleQueueMessage}
                onStop={handleStop}
              />
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
