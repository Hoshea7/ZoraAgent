import { randomUUID } from "node:crypto";
import type {
  AgentRunSource,
  AgentStreamEvent,
  FileAttachment,
  SessionMeta,
} from "../shared/zora";
import { resolveDefaultModelTarget } from "./default-model-settings";
import { memoryAgent } from "./memory-agent";
import { agentExecutionService } from "./agent-execution-service";
import {
  resolveAgentRuntimeTarget,
  type AgentRuntimeTarget,
} from "./runtime/runtime-execution-target";
import {
  AgentRuntimeNotAvailableError,
  DEFAULT_AGENT_RUNTIME,
} from "./runtime/types";
import type { AgentPermissionIntent } from "./agent-profiles";
import { getErrorMessage, logSystemEvent } from "./system-log";
import {
  appendMessageRecord,
  createSession,
  flushSessionWrites,
  getSessionMeta,
  persistAssistantMessage,
  persistToolResults,
  saveAttachments,
  updateSessionMeta,
} from "./session-store";
import type { AgentRuntimeResult } from "./runtime/types";
import { getSharedMcpManager } from "./mcp-manager";
import { createToolProvisioningPlan } from "./runtime/tool-provisioning";
import { delegationCoordinator } from "./delegation/service";
import { createSubtaskProvisionedTools } from "./delegation/subtask-tools";
import { setPermissionMode as setSessionPermissionMode } from "./hitl";

type ForwardEvent = (payload: AgentStreamEvent) => void;

interface RunPromptInSessionOptions {
  sessionId: string;
  workspaceId: string;
  text: string;
  forwardEvent: ForwardEvent;
  attachments?: FileAttachment[];
  source: AgentRunSource;
  waitForCompletion?: boolean;
  permissionMode?: AgentPermissionIntent;
  userMessageId?: string;
  beforeRun?: (session: SessionMeta) => Promise<void> | void;
}

interface RunPromptInNewSessionOptions
  extends Omit<RunPromptInSessionOptions, "sessionId"> {
  title: string;
}

export async function runPromptInSession({
  sessionId,
  workspaceId,
  text,
  forwardEvent,
  attachments,
  source,
  waitForCompletion = false,
  permissionMode = "interactive",
  userMessageId,
  beforeRun,
}: RunPromptInSessionOptions): Promise<AgentRuntimeResult | undefined> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error("A non-empty text is required.");
  }

  const session = await getSessionMeta(sessionId, workspaceId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found.`);
  }
  setSessionPermissionMode(session.permissionMode ?? "ask", sessionId);

  let providerId = session.providerId;
  let selectedModelId = session.selectedModelId;
  const sessionUpdates: Parameters<typeof updateSessionMeta>[1] = {};

  if (!session.providerLocked) {
    const defaultTarget = await resolveDefaultModelTarget();
    if (!defaultTarget) {
      logSystemEvent(
        "app",
        "session-runner",
        "model:missing",
        "会话启动失败：未配置可用模型",
        { sessionId, workspaceId, source },
        { level: "warn" }
      );
      throw new Error("当前未配置可用模型，请先在设置里完成模型配置。");
    }

    providerId = defaultTarget.provider.id;
    selectedModelId = defaultTarget.selectedModelId;
    sessionUpdates.providerId = defaultTarget.provider.id;
    sessionUpdates.providerLocked = true;
    sessionUpdates.selectedModelId = defaultTarget.selectedModelId;
  }

  await updateSessionMeta(sessionId, sessionUpdates, workspaceId);

  const savedAttachments =
    attachments && attachments.length > 0
      ? await saveAttachments(sessionId, attachments, workspaceId)
      : [];

  await appendMessageRecord(
    sessionId,
    {
      kind: "user",
      message: {
        id: userMessageId ?? `user-${randomUUID()}`,
        role: "user",
        text: trimmedText,
        timestamp: Date.now(),
        attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
      },
    },
    workspaceId
  );
  if (source !== "delegation") {
    memoryAgent.scheduleProcessing(sessionId, workspaceId);
  }

  const updatedSession = {
    ...session,
    ...sessionUpdates,
  };
  await beforeRun?.(updatedSession);

  const agentRuntimeType = session.agentRuntimeType ?? DEFAULT_AGENT_RUNTIME;
  const reasoningLevel = session.reasoningLevel ?? "high";
  let target: AgentRuntimeTarget;
  try {
    target = await resolveAgentRuntimeTarget({
      agentRuntimeType,
      providerId,
      selectedModelId,
    });
  } catch (error) {
    logSystemEvent(
      "agent",
      "session-runner",
      "runtime:resolve:error",
      "Runtime 执行目标解析失败",
      {
        sessionId,
        workspaceId,
        agentRuntimeType,
        providerId,
        reason:
          error instanceof AgentRuntimeNotAvailableError
            ? error.reason
            : undefined,
        error: getErrorMessage(error),
      },
      { level: "error" }
    );
    throw error;
  }

  const wrappedForwardEvent = (payload: AgentStreamEvent) => {
    forwardEvent(payload);

    const message = payload as Record<string, unknown>;
    if (message.type === "assistant" && "message" in message) {
      void persistAssistantMessage(sessionId, message, workspaceId).catch(
        (error) => {
          console.error(
            `[session-runner] Failed to persist assistant message for session ${sessionId}:`,
            error
          );
        }
      );
    }

    if (message.type === "user" && "message" in message) {
      void persistToolResults(sessionId, message.message, workspaceId).catch(
        (error) => {
          console.error(
            `[session-runner] Failed to persist tool results for session ${sessionId}:`,
            error
          );
        }
      );
    }

  };

  const toolProvisioningRequest = {
    sessionId,
    workspaceId,
    runtime: target.agentRuntimeType,
    source,
  } as const;
  const mcpConfig = await getSharedMcpManager().getEditableConfig();
  const subtaskTools =
    source !== "delegation" && !updatedSession.parentSessionId
      ? createSubtaskProvisionedTools(
          delegationCoordinator.forScope({
            workspaceId,
            parentSessionId: sessionId,
          }),
          {
            runtime: target.agentRuntimeType,
            providerId: target.provider.id,
            modelId: target.modelId,
          }
        )
      : [];
  const fullToolPlan = createToolProvisioningPlan(mcpConfig, subtaskTools);
  const toolProvisioningPlan = fullToolPlan;

  const runtimeInput = {
    sessionId,
    workspaceId,
    prompt: trimmedText,
    forwardEvent: wrappedForwardEvent,
    attachments,
    permissionMode,
    source,
    target,
    workingDirectory: updatedSession.workingDirectory,
    reasoningLevel,
    toolProvisioningPlan,
    toolProvisioningRequest,
  };
  const runPromise = agentExecutionService.execute(runtimeInput);

  if (waitForCompletion) {
    const result = await runPromise;
    await flushSessionWrites(sessionId, workspaceId);
    return result;
  }

  void runPromise.catch((error) => {
    logSystemEvent(
      "app",
      "session-runner",
      "agent:error",
      "会话 Agent 运行失败",
      { sessionId, workspaceId, error: getErrorMessage(error) },
      { level: "error" }
    );
  });
  return undefined;
}

export async function runPromptInNewSession({
  title,
  workspaceId,
  ...options
}: RunPromptInNewSessionOptions): Promise<SessionMeta> {
  const session = await createSession(title, workspaceId);

  await runPromptInSession({
    ...options,
    sessionId: session.id,
    workspaceId,
  });

  return session;
}
