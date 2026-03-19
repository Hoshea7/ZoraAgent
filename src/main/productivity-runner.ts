import type {
  AgentRunSource,
  AgentStreamEvent,
  ChatMessage,
  FileAttachment,
} from "../shared/zora";
import {
  MissingSdkSessionError,
  resolveSDKCliPath,
  runAgentWithProfile,
} from "./agent";
import { buildProductivityProfile } from "./query-profiles";
import {
  clearSdkSessionId,
  getSdkSessionId,
  loadMessages,
} from "./session-store";
import { getWorkspacePath } from "./workspace-store";

const RECOVERY_MAX_MESSAGES = 80;
const RECOVERY_MAX_TRANSCRIPT_CHARS = 100_000;
const RECOVERY_MAX_TOOL_IO_CHARS = 4_000;

export interface RunProductivitySessionParams {
  sessionId: string;
  text: string;
  forwardEvent: (payload: AgentStreamEvent) => void;
  workspaceId?: string;
  attachments?: FileAttachment[];
  permissionMode?: "default" | "bypassPermissions";
  source?: AgentRunSource;
}

function truncateForRecovery(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function serializeMessageForRecovery(message: ChatMessage): string[] {
  if (message.role === "user") {
    const text = message.text.trim();
    return text ? [`User: ${text}`] : [];
  }

  if (message.type === "text") {
    const text = message.text.trim();
    return text ? [`Assistant: ${text}`] : [];
  }

  if (message.type === "tool_use") {
    const toolName = message.toolName || "unknown";
    const sections = [
      `Assistant used tool ${toolName} with input:\n${truncateForRecovery(
        message.toolInput || "(empty input)",
        RECOVERY_MAX_TOOL_IO_CHARS
      )}`,
    ];

    if (message.toolResult) {
      sections.push(
        `Tool result from ${toolName}:\n${truncateForRecovery(
          message.toolResult,
          RECOVERY_MAX_TOOL_IO_CHARS
        )}`
      );
    }

    return sections;
  }

  return [];
}

function buildRecoveredPromptFromMessages(
  messages: ChatMessage[],
  fallbackUserPrompt: string
): string {
  const transcriptSections: string[] = [];
  let transcriptLength = 0;

  for (const message of messages.slice(-RECOVERY_MAX_MESSAGES)) {
    for (const section of serializeMessageForRecovery(message)) {
      if (transcriptLength + section.length > RECOVERY_MAX_TRANSCRIPT_CHARS) {
        transcriptSections.push("[Earlier transcript truncated for length.]");
        transcriptLength = RECOVERY_MAX_TRANSCRIPT_CHARS;
        break;
      }

      transcriptSections.push(section);
      transcriptLength += section.length + 2;
    }

    if (transcriptLength >= RECOVERY_MAX_TRANSCRIPT_CHARS) {
      break;
    }
  }

  const transcript =
    transcriptSections.length > 0
      ? transcriptSections.join("\n\n")
      : `User: ${fallbackUserPrompt}`;

  return [
    "The previous Claude Code session for this local Zora conversation is unavailable.",
    "Resume the conversation from the locally persisted transcript below.",
    "Treat the transcript as authoritative history for this conversation.",
    "Continue naturally from the final user message without mentioning recovery unless the user asks.",
    "Conversation transcript:",
    transcript,
  ].join("\n\n");
}

function applyPermissionMode(
  profile: Awaited<ReturnType<typeof buildProductivityProfile>>,
  permissionMode: "default" | "bypassPermissions"
): void {
  profile.options.permissionMode = permissionMode;

  if (permissionMode === "bypassPermissions") {
    delete profile.options.canUseTool;
  }
}

export async function runProductivitySession({
  sessionId,
  text,
  forwardEvent,
  workspaceId = "default",
  attachments,
  permissionMode = "default",
  source = "desktop",
}: RunProductivitySessionParams): Promise<void> {
  const sdkCliPath = resolveSDKCliPath();
  const currentPrompt = text.trim();
  const existingSDKSessionId = await getSdkSessionId(sessionId, workspaceId);
  const workspacePath = await getWorkspacePath(workspaceId);
  const persistedMessages = existingSDKSessionId
    ? []
    : await loadMessages(sessionId, workspaceId);
  const shouldRecoverFromTranscript =
    !existingSDKSessionId && persistedMessages.length > 1;
  const initialPrompt = shouldRecoverFromTranscript
    ? buildRecoveredPromptFromMessages(persistedMessages, currentPrompt)
    : currentPrompt;

  if (shouldRecoverFromTranscript) {
    console.warn(
      `[productivity-runner] Local session ${sessionId} has persisted history but no stored SDK session. Rebuilding context from local transcript.`
    );
  }

  const profile = await buildProductivityProfile({
    userPrompt: initialPrompt,
    cwd: workspacePath,
    sdkCliPath,
    onEvent: forwardEvent,
    isFirstTurn: !existingSDKSessionId && !shouldRecoverFromTranscript,
    sessionId: existingSDKSessionId,
  });
  applyPermissionMode(profile, permissionMode);

  try {
    await runAgentWithProfile(
      sessionId,
      profile,
      forwardEvent,
      attachments,
      workspaceId,
      source
    );
  } catch (error) {
    if (!(error instanceof MissingSdkSessionError) || !existingSDKSessionId) {
      throw error;
    }

    console.warn(
      `[productivity-runner] Stored SDK session ${existingSDKSessionId} is unavailable for local session ${sessionId}. Rebuilding context from local transcript.`
    );

    await clearSdkSessionId(sessionId, workspaceId);
    const recoveredMessages =
      persistedMessages.length > 0
        ? persistedMessages
        : await loadMessages(sessionId, workspaceId);
    const rebuiltPrompt = buildRecoveredPromptFromMessages(
      recoveredMessages,
      currentPrompt
    );
    const recoveredProfile = await buildProductivityProfile({
      userPrompt: rebuiltPrompt,
      cwd: workspacePath,
      sdkCliPath,
      onEvent: forwardEvent,
      isFirstTurn: false,
      sessionId: undefined,
    });
    applyPermissionMode(recoveredProfile, permissionMode);

    await runAgentWithProfile(
      sessionId,
      recoveredProfile,
      forwardEvent,
      attachments,
      workspaceId,
      source
    );
  }
}
