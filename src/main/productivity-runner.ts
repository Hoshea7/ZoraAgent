import type {
  AgentRunSource,
  AgentStreamEvent,
  ConversationMessage,
  FileAttachment,
} from "../shared/zora";
import {
  type AgentRunResult,
  MissingSdkSessionError,
  type QueuedAgentMessage,
  runAgentWithProfile,
} from "./agent";
import { buildProductivityProfile } from "./query-profiles";
import { getSDKRuntimeOptions } from "./sdk-runtime";
import {
  clearSdkSessionId,
  getSdkSessionId,
} from "./session-store";
import {
  formatDurationMs,
  logAgentEvent,
  logAgentLoopEnd,
  logAgentLoopStart,
} from "./agent-loop-log";
import type { AgentRuntimeTarget } from "./runtime/runtime-execution-target";
import type { ToolGate } from "./runtime/tool-gate";
import type { AgentRequest } from "./agent-profiles";
import { composeHarnessPrompt } from "./agent-profiles";

const RECOVERY_MAX_MESSAGES = 80;
const RECOVERY_MAX_TRANSCRIPT_CHARS = 100_000;
const RECOVERY_MAX_TOOL_IO_CHARS = 4_000;
const LATE_QUEUE_FOLLOW_UP_MAX_RUNS = 20;

export interface RunProductivitySessionParams {
  harness: AgentRequest;
  forwardEvent: (payload: AgentStreamEvent) => void;
  attachments?: FileAttachment[];
  source?: AgentRunSource;
  executionTarget?: AgentRuntimeTarget;
  toolGate?: ToolGate;
}

type ProductivityProfile = Awaited<ReturnType<typeof buildProductivityProfile>>;

type BuildRunProfileParams = {
  userPrompt: string;
  harness: AgentRequest;
  sdkRuntime: ReturnType<typeof getSDKRuntimeOptions>;
  forwardEvent: (payload: AgentStreamEvent) => void;
  isFirstTurn: boolean;
  sdkSessionId?: string;
  localSessionId: string;
  executionTarget?: AgentRuntimeTarget;
  toolGate?: ToolGate;
};

function truncateForRecovery(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function serializeMessageForRecovery(message: ConversationMessage): string[] {
  if (message.role === "user") {
    const text = message.text?.trim() ?? "";
    return text ? [`User: ${text}`] : [];
  }

  const turn = message.turn;
  if (!turn) {
    return [];
  }

  const sections: string[] = [];
  const bodyText = turn.bodySegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n\n");

  if (bodyText) {
    sections.push(`Assistant: ${bodyText}`);
  }

  for (const step of turn.processSteps) {
    if (step.type !== "tool") {
      continue;
    }

    sections.push(
      `Assistant used tool ${step.tool.name} with input:\n${truncateForRecovery(
        step.tool.input || "(empty input)",
        RECOVERY_MAX_TOOL_IO_CHARS
      )}`
    );

    if (step.tool.result) {
      sections.push(
        `Tool result from ${step.tool.name}:\n${truncateForRecovery(
          step.tool.result,
          RECOVERY_MAX_TOOL_IO_CHARS
        )}`
      );
    }
  }

  return sections;
}

function buildRecoveredPromptFromMessages(
  messages: ConversationMessage[],
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
  profile: ProductivityProfile,
  permissionMode: "default" | "bypassPermissions"
): void {
  profile.options.permissionMode = permissionMode;

  if (permissionMode === "bypassPermissions") {
    delete profile.options.canUseTool;
  }
}

function buildLateQueuedPrompt(messages: QueuedAgentMessage[]): string {
  if (messages.length === 1) {
    return messages[0]?.text ?? "";
  }

  return messages
    .map((message, index) => `Queued message ${index + 1}:\n${message.text}`)
    .join("\n\n");
}

async function buildRunProfile({
  userPrompt,
  harness,
  sdkRuntime,
  forwardEvent,
  isFirstTurn,
  sdkSessionId,
  localSessionId,
  executionTarget,
  toolGate,
}: BuildRunProfileParams): Promise<ProductivityProfile> {
  logAgentEvent("pre", "context:start", "动态加载 Agent 上下文中", {
    workspace: harness.workspaceId,
    cwd: harness.workspace.cwd,
  });
  logAgentEvent("pre", "context:done", "动态 Agent 上下文已生成", {
    promptChars: userPrompt.length,
  });

  const profile = await buildProductivityProfile({
    userPrompt,
    cwd: harness.workspace.cwd,
    sdkRuntime,
    onEvent: forwardEvent,
    isFirstTurn,
    sessionId: sdkSessionId,
    localSessionId,
    executionTarget,
    toolGate,
    systemPromptAppend: harness.prompt.system,
    maxTurns: harness.budget.maxTurns,
    reasoningLevel: harness.model.reasoningLevel,
  });
  applyPermissionMode(
    profile,
    harness.permissions.mode === "unattended" ? "bypassPermissions" : "default"
  );
  return profile;
}

export async function runProductivitySession({
  harness,
  forwardEvent,
  attachments,
  source = "desktop",
  executionTarget,
  toolGate,
}: RunProductivitySessionParams): Promise<void> {
  const { sessionId, workspaceId } = harness;
  const loopStartedAt = Date.now();
  let loopStatus: "success" | "error" = "success";
  logAgentLoopStart("ProductivityAgent", {
    query: harness.prompt.user.trim(),
    session: sessionId,
    source,
    workspace: workspaceId,
  });

  try {
    const sdkRuntime = getSDKRuntimeOptions();
    const currentPrompt = harness.prompt.user.trim();
    const existingSDKSessionId = await getSdkSessionId(sessionId, workspaceId);
    const persistedMessages = harness.conversation.messages;
    const shouldRecoverFromTranscript =
      !existingSDKSessionId && persistedMessages.length > 1;
    const initialPrompt = shouldRecoverFromTranscript
      ? composeHarnessPrompt(
          harness,
          buildRecoveredPromptFromMessages(persistedMessages, currentPrompt)
        )
      : composeHarnessPrompt(harness);

    if (shouldRecoverFromTranscript) {
      logAgentEvent("pre", "recover", "本地历史恢复上下文", {
        reason: "local_transcript_without_sdk_session",
        persistedMessages: persistedMessages.length,
      });
    }

    const profile = await buildRunProfile({
      userPrompt: initialPrompt,
      harness,
      sdkRuntime,
      forwardEvent,
      isFirstTurn: !existingSDKSessionId && !shouldRecoverFromTranscript,
      localSessionId: sessionId,
      sdkSessionId: existingSDKSessionId,
      executionTarget,
      toolGate,
    });

    let runResult: AgentRunResult;

    try {
      runResult = await runAgentWithProfile(
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

      logAgentEvent("pre", "recover", "本地历史恢复上下文", {
        reason: "stored_sdk_session_unavailable",
        sdkSessionId: existingSDKSessionId,
      });

      await clearSdkSessionId(sessionId, workspaceId);
      const rebuiltPrompt = composeHarnessPrompt(
        harness,
        buildRecoveredPromptFromMessages(persistedMessages, currentPrompt)
      );
      const recoveredProfile = await buildRunProfile({
        userPrompt: rebuiltPrompt,
        harness,
        sdkRuntime,
        forwardEvent,
        isFirstTurn: false,
        localSessionId: sessionId,
        executionTarget,
        toolGate,
      });

      runResult = await runAgentWithProfile(
        sessionId,
        recoveredProfile,
        forwardEvent,
        attachments,
        workspaceId,
        source
      );
    }

    let followUpCount = 0;
    while (runResult.lateQueuedMessages.length > 0) {
      followUpCount += 1;
      if (followUpCount > LATE_QUEUE_FOLLOW_UP_MAX_RUNS) {
        logAgentEvent("runtime", "queue:replay:stop", "队列补跑停止", {
          maxRuns: LATE_QUEUE_FOLLOW_UP_MAX_RUNS,
        });
        break;
      }

      const followUpPrompt = buildLateQueuedPrompt(runResult.lateQueuedMessages);
      if (!followUpPrompt.trim()) {
        break;
      }

      const resumeSessionId =
        runResult.sdkSessionId ?? await getSdkSessionId(sessionId, workspaceId);
      logAgentEvent("runtime", "queue:replay:start", "队列补跑开始", {
        messages: runResult.lateQueuedMessages.length,
        resume: Boolean(resumeSessionId),
        sdkSessionId: resumeSessionId,
      });

      const followUpProfile = await buildRunProfile({
        userPrompt: composeHarnessPrompt(harness, followUpPrompt),
        harness,
        sdkRuntime,
        forwardEvent,
        isFirstTurn: false,
        localSessionId: sessionId,
        sdkSessionId: resumeSessionId,
        executionTarget,
        toolGate,
      });

      runResult = await runAgentWithProfile(
        sessionId,
        followUpProfile,
        forwardEvent,
        undefined,
        workspaceId,
        source
      );
    }
  } catch (error) {
    loopStatus = "error";
    throw error;
  } finally {
    logAgentLoopEnd("ProductivityAgent", {
      status: loopStatus,
      totalDuration: formatDurationMs(Date.now() - loopStartedAt),
      session: sessionId,
      workspace: workspaceId,
    });
  }
}
