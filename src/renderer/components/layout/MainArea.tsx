import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  clearDraftAttachmentsAtom,
  draftAttachmentsAtom,
  hasMessagesAtom,
  messagesAtom,
  queueConversationAtom,
  activateQueuedConversationAtom,
  deferQueuedConversationsAtom,
  failTurnAtom,
  draftAtom,
  reviseConversationAtom,
  setSessionRunningAtom,
  currentSessionRunIdAtom,
  appendCorrectionConversationAtom,
} from "../../store/chat";
import { formatUserCorrection } from "../../../shared/correction";
import type { EditIntent } from "../../../shared/zora";
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

function createUserMessageId() {
  return `user-${
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }`;
}

export function MainArea() {
  const queueConversation = useSetAtom(queueConversationAtom);
  const activateQueuedConversation = useSetAtom(activateQueuedConversationAtom);
  const deferQueuedConversations = useSetAtom(deferQueuedConversationsAtom);
  const failTurn = useSetAtom(failTurnAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const reviseConversation = useSetAtom(reviseConversationAtom);
  const appendCorrectionConversation = useSetAtom(
    appendCorrectionConversationAtom
  );
  const clearAttachments = useSetAtom(clearDraftAttachmentsAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const hasMessages = useAtomValue(hasMessagesAtom);
  const attachments = useAtomValue(draftAttachmentsAtom);
  const messages = useAtomValue(messagesAtom);
  const providers = useAtomValue(providersAtom);
  const defaultModelSettings = useAtomValue(defaultModelSettingsAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const draftSelectedProviderId = useAtomValue(draftSelectedProviderIdAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const draftAgentRuntimeType = useAtomValue(draftAgentRuntimeTypeAtom);
  const draftReasoningLevel = useAtomValue(draftReasoningLevelAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const currentRunId = useAtomValue(currentSessionRunIdAtom);
  const [currentWorkspaceId] = useAtom(currentWorkspaceIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const touchSession = useSetAtom(touchSessionAtom);
  const setDraftSelectedProviderId = useSetAtom(setDraftSelectedProviderIdAtom);
  const setDraftSelectedModelId = useSetAtom(setDraftSelectedModelIdAtom);
  const setDraftAgentRuntimeType = useSetAtom(setDraftAgentRuntimeTypeAtom);
  const setDraftReasoningLevel = useSetAtom(setDraftReasoningLevelAtom);
  const updateSessionMetaInState = useSetAtom(updateSessionMetaInStateAtom);
  const isEmptyConversation = !hasMessages;

  const handleSend = async () => {
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
      isLockedTargetUnavailable,
    } = resolveCurrentProviderAndModel(
      providers,
      activeSession,
      effectiveDefaultModelSettings,
      draftSelectedProviderId,
      draftSelectedModelId
    );

    if (isLockedTargetUnavailable) {
      if (currentSessionId) {
        failTurn(currentSessionId, "当前会话的模型不可用，请先选择其他模型。");
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
    try {
      if (selectedProvider?.id) {
        await window.zora.lockSessionModel(
          sessionId,
          selectedProvider.id,
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

    const userMessageId = createUserMessageId();
    queueConversation(
      sessionId,
      text,
      userMessageId,
      currentAttachments
    );
    touchSession(sessionId);
    setDraft("");
    clearAttachments();

    try {
      const result = await window.zora.submitUserMessage({
        text: chatText,
        sessionId,
        messageId: userMessageId,
        workspaceId: currentWorkspaceId,
        attachments:
          currentAttachments.length > 0 ? currentAttachments : undefined,
      });
      setSessionRunning(sessionId, true, result.source, result.runId);
      if (result.mode === "started") {
        activateQueuedConversation(sessionId, userMessageId);
      }
    } catch (error) {
      deferQueuedConversations(sessionId);
      failTurn(sessionId, getErrorMessage(error));
    }
  };

  const handleStop = async () => {
    if (!currentSessionId) {
      return;
    }

    try {
      const runId =
        currentRunId ?? (await window.zora.getAgentRunInfo(currentSessionId)).runId;
      if (!runId) {
        return;
      }
      const result = await window.zora.stopAgent(currentSessionId, runId);
      if (result.mode === "state_changed") {
        setSessionRunning(currentSessionId, true, undefined, result.activeRunId);
      }
    } catch (error) {
      failTurn(currentSessionId, getErrorMessage(error));
      throw error;
    }
  };

  const handleReviseMessage = async (
    messageId: string,
    text: string,
    intent: EditIntent,
    observedRunId?: string
  ) => {
    if (!currentSessionId || !currentSession) {
      return;
    }

    try {
      const result = await window.zora.submitUserEdit({
        sessionId: currentSessionId,
        targetMessageId: messageId,
        text,
        intent,
        observedRunId,
        workspaceId: currentWorkspaceId,
      });
      if (result.mode === "state_changed") {
        if (result.activeRunId) {
          setSessionRunning(
            currentSessionId,
            true,
            undefined,
            result.activeRunId
          );
        }
        throw new Error("会话运行状态已变化，请检查当前输出后重新提交。");
      }
      if (result.mode === "revised") {
        reviseConversation(currentSessionId, messageId, text);
        updateSessionMetaInState({
          sessionId: currentSessionId,
          updates: {
            sdkSessionId: result.session.sdkSessionId,
            contextWindowState: result.session.contextWindowState,
          },
        });
      } else {
        const originalText =
          messages.find((message) => message.id === messageId)?.text ?? "";
        appendCorrectionConversation(
          currentSessionId,
          {
            id: result.correctionMessageId,
            role: "user",
            text: formatUserCorrection(originalText, text.trim()),
            timestamp: Date.now(),
            correction: { targetMessageId: messageId },
          },
          result.mode === "steered"
        );
      }
      setSessionRunning(currentSessionId, true, undefined, result.runId);
      touchSession(currentSessionId);
    } catch (error) {
      throw new Error(getErrorMessage(error));
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
                  onSend={handleSend}
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
            <MessageList
              onReviseMessage={handleReviseMessage}
            />
          </div>

          <footer className="titlebar-no-drag shrink-0 bg-white px-5 py-4 sm:px-8">
            <div className="mx-auto w-full max-w-[920px]">
              <PermissionBanner />
              <AskUserBanner />
              <ChatInput
                onSend={handleSend}
                onStop={handleStop}
              />
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
