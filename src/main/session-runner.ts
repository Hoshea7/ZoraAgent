import { randomUUID } from "node:crypto";
import type {
  AgentRunSource,
  AgentStreamEvent,
  FileAttachment,
  ManualCompactionResult,
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
  loadMessages,
  persistAssistantMessage,
  persistToolResults,
  projectSavedAttachments,
  reviseUserMessageRecord,
  saveAttachments,
  updateSessionMeta,
} from "./session-store";
import type { AgentRuntimeResult } from "./runtime/types";
import { getSharedMcpManager } from "./mcp-manager";
import { createToolProvisioningPlan } from "./runtime/tool-provisioning";
import { delegationCoordinator } from "./delegation/service";
import { createSubtaskProvisionedTools } from "./delegation/subtask-tools";
import { setPermissionMode as setSessionPermissionMode } from "./hitl";
import { visionSettingsStore } from "./vision-settings";
import { createRuntimeModelCapabilityResolver } from "./model-capability-service";
import type { RuntimeProjectionFingerprint } from "../shared/types/vision";
import { agentRuntimeRouter } from "./runtime";
import {
  createRuntimeProjectionFingerprint,
  hasRuntimeProjectionChanged,
} from "./runtime/runtime-projection";
import { emitSessionSync } from "./session-sync";

type ForwardEvent = (payload: AgentStreamEvent) => void;

const sessionOperationQueues = new Map<string, Promise<unknown>>();

async function runSessionOperation<T>(
  sessionId: string,
  workspaceId: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = `${workspaceId}\0${sessionId}`;
  const previous = sessionOperationQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  sessionOperationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (sessionOperationQueues.get(key) === current) {
      sessionOperationQueues.delete(key);
    }
  }
}

interface RunPromptInSessionOptions {
  sessionId: string;
  runId?: string;
  workspaceId: string;
  text: string;
  forwardEvent: ForwardEvent;
  attachments?: FileAttachment[];
  source: AgentRunSource;
  waitForCompletion?: boolean;
  permissionMode?: AgentPermissionIntent;
  userMessageId?: string;
  beforeRun?: (session: SessionMeta) => Promise<void> | void;
  compactRequest?: boolean;
  messageAlreadyPersisted?: boolean;
  onRunStarted?: (runId: string) => void;
}

interface RunPromptInNewSessionOptions
  extends Omit<RunPromptInSessionOptions, "sessionId" | "compactRequest"> {
  title: string;
}

export function runPromptInSession(
  options: RunPromptInSessionOptions & { compactRequest: true }
): Promise<ManualCompactionResult>;
export function runPromptInSession(
  options: RunPromptInSessionOptions & { compactRequest?: false }
): Promise<AgentRuntimeResult | undefined>;
export function runPromptInSession(
  options: RunPromptInSessionOptions
): Promise<AgentRuntimeResult | ManualCompactionResult | undefined> {
  return runSessionOperation(options.sessionId, options.workspaceId, () =>
    runPromptInSessionUnlocked(options)
  );
}

async function runPromptInSessionUnlocked({
  sessionId,
  runId = randomUUID(),
  workspaceId,
  text,
  forwardEvent,
  attachments,
  source,
  waitForCompletion = false,
  permissionMode = "interactive",
  userMessageId,
  beforeRun,
  compactRequest = false,
  messageAlreadyPersisted = false,
  onRunStarted,
}: RunPromptInSessionOptions): Promise<
  AgentRuntimeResult | ManualCompactionResult | undefined
> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error("A non-empty text is required.");
  }
  if (agentExecutionService.isRunning(sessionId)) {
    throw new Error(`An agent is already running for session ${sessionId}.`);
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
    !compactRequest &&
    !messageAlreadyPersisted &&
    attachments &&
    attachments.length > 0
      ? await saveAttachments(sessionId, attachments, workspaceId)
      : [];
  const runtimeAttachments = messageAlreadyPersisted
    ? attachments
    : savedAttachments.length > 0
      ? await projectSavedAttachments(sessionId, savedAttachments, workspaceId)
      : undefined;

  if (!compactRequest && !messageAlreadyPersisted) {
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
  }

  if (!compactRequest && source !== "delegation") {
    memoryAgent.scheduleProcessing(sessionId, workspaceId);
  }
  await emitSessionSync({
    sessionId,
    runId,
    workspaceId,
    source,
    forwardEvent,
  });

  const updatedSession = {
    ...session,
    ...sessionUpdates,
  };
  await beforeRun?.(updatedSession);
  const workingDirectory = updatedSession.workingDirectory;
  if (!workingDirectory) {
    throw new Error(`Session ${sessionId} has no working directory.`);
  }

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

  const visionSettings = await visionSettingsStore.load();
  const imageInputCapability = (await createRuntimeModelCapabilityResolver(
    visionSettings.capabilityOverrides
  )).resolve(
    { providerId: target.provider.id, modelId: target.modelId },
    { providerType: target.provider.providerType }
  );
  const runtimeProjectionFingerprint: RuntimeProjectionFingerprint =
    createRuntimeProjectionFingerprint({
      runtime: agentRuntimeType,
      providerId: target.provider.id,
      modelId: target.modelId,
      imageInputCapability,
      contextWindow: target.contextWindow,
    });
  let visionRelayEnabled = false;
  if (visionSettings.relay.enabled) {
    try {
      visionRelayEnabled = (await visionSettingsStore.resolveRoute()) !== null;
    } catch {
      visionRelayEnabled = false;
    }
  }
  const runtimeProjectionChanged = hasRuntimeProjectionChanged(
    session.runtimeProjectionFingerprint,
    runtimeProjectionFingerprint
  );
  if (runtimeProjectionChanged) {
    agentRuntimeRouter.deleteSessionData(sessionId, workspaceId);
    await updateSessionMeta(
      sessionId,
      {
        sdkSessionId: undefined,
        runtimeProjectionFingerprint,
        contextWindowState: undefined,
      },
      workspaceId
    );
  }

  let agentErrorForwarded = false;
  const wrappedForwardEvent = (payload: AgentStreamEvent) => {
    if (payload.type === "agent_error") {
      agentErrorForwarded = true;
    }
    const event = payload.type === "context_usage"
      ? {
          ...payload,
          state: {
            ...payload.state,
            compactionCount:
              (runtimeProjectionChanged
                ? 0
                : session.contextWindowState?.compactionCount ?? 0)
              + payload.state.compactionCount,
          },
          workspaceId,
        }
      : payload;
    forwardEvent(event);

    if (event.type === "context_usage") {
      void updateSessionMeta(
        sessionId,
        { contextWindowState: event.state },
        workspaceId
      );
    }

    const message = event as Record<string, unknown>;
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

  const toolRunContext = {
    sessionId,
    workspaceId,
    runtime: target.agentRuntimeType,
    mainModel: {
      providerId: target.provider.id,
      modelId: target.modelId,
    },
    runOrigin: source,
    workingDirectory,
    vision: { imageInputCapability, visionRelayEnabled },
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
  const toolProvisioningPlan = createToolProvisioningPlan(
    mcpConfig,
    subtaskTools,
    toolRunContext
  );

  const runtimeInput = {
    sessionId,
    runId,
    workspaceId,
    prompt: trimmedText,
    forwardEvent: wrappedForwardEvent,
    attachments: runtimeAttachments,
    permissionMode,
    source,
    target,
    workingDirectory,
    reasoningLevel,
    toolProvisioningPlan,
    vision: { imageInputCapability, visionRelayEnabled },
  };
  const runPromise = compactRequest
    ? agentExecutionService.compact(runtimeInput)
    : agentExecutionService.execute(runtimeInput);
  if (!compactRequest) {
    onRunStarted?.(runId);
  }

  if (waitForCompletion) {
    const result = await runPromise;
    await flushSessionWrites(sessionId, workspaceId);
    return result;
  }

  void runPromise.catch((error) => {
    if (!agentErrorForwarded) {
      forwardEvent({ type: "agent_error", error: getErrorMessage(error), runId });
    }
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

export interface RevisePromptInSessionOptions {
  sessionId: string;
  runId: string;
  workspaceId: string;
  messageId: string;
  text: string;
  forwardEvent: ForwardEvent;
}

/**
 * Rewrites the product-owned transcript, invalidates runtime-derived context,
 * and starts a new run from the revised user message.
 */
export async function revisePromptInSession({
  sessionId,
  runId,
  workspaceId,
  messageId,
  text,
  forwardEvent,
}: RevisePromptInSessionOptions): Promise<SessionMeta> {
  return runSessionOperation(sessionId, workspaceId, async () => {
    if (agentExecutionService.isRunning(sessionId)) {
      throw new Error("当前会话正在运行，请先停止后再修改消息。");
    }

    const session = await getSessionMeta(sessionId, workspaceId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found.`);
    }

    const currentMessages = await loadMessages(sessionId, workspaceId);
    const targetMessage = currentMessages.find(
      (message) => message.role === "user" && message.id === messageId
    );
    if (!targetMessage) {
      throw new Error(`Message ${messageId} not found in session ${sessionId}.`);
    }
    if (!text.trim() && !targetMessage.attachments?.length) {
      throw new Error("Message text cannot be empty when there are no attachments.");
    }

    agentRuntimeRouter.deleteSessionData(sessionId, workspaceId);
    await updateSessionMeta(
      sessionId,
      {
        sdkSessionId: undefined,
        contextWindowState: undefined,
      },
      workspaceId
    );

    const messages = await reviseUserMessageRecord(
      sessionId,
      messageId,
      text,
      workspaceId
    );
    const revisedMessage = messages.at(-1);
    if (!revisedMessage || revisedMessage.role !== "user" || revisedMessage.id !== messageId) {
      throw new Error(`Message ${messageId} was not revised.`);
    }

    await runPromptInSessionUnlocked({
      sessionId,
      runId,
      workspaceId,
      text: revisedMessage.text?.trim() || "我发送了一些附件。",
      attachments: revisedMessage.attachments,
      source: "desktop",
      forwardEvent,
      messageAlreadyPersisted: true,
    });

    const updatedSession = await getSessionMeta(sessionId, workspaceId);
    if (!updatedSession) {
      throw new Error(`Session ${sessionId} not found after revision.`);
    }

    return updatedSession;
  });
}

export async function compactSessionContext(
  sessionId: string,
  workspaceId: string,
  forwardEvent: ForwardEvent
): Promise<ManualCompactionResult> {
  const session = await getSessionMeta(sessionId, workspaceId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found.`);
  }

  const result = await runPromptInSession({
    sessionId,
    workspaceId,
    text: "手动压缩上下文",
    forwardEvent,
    source: "desktop",
    waitForCompletion: true,
    compactRequest: true,
  });
  return result;
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
