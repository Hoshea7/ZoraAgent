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
  persistAssistantMessage,
  persistToolResults,
  projectSavedAttachments,
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
  compactRequest?: boolean;
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
  compactRequest = false,
}: RunPromptInSessionOptions): Promise<
  AgentRuntimeResult | ManualCompactionResult | undefined
> {
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
    !compactRequest && attachments && attachments.length > 0
      ? await saveAttachments(sessionId, attachments, workspaceId)
      : [];
  const runtimeAttachments =
    savedAttachments.length > 0
      ? await projectSavedAttachments(sessionId, savedAttachments, workspaceId)
      : undefined;

  if (!compactRequest) {
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
  }

  const updatedSession = {
    ...session,
    ...sessionUpdates,
  };
  await beforeRun?.(updatedSession);

  const agentRuntimeType = session.agentRuntimeType ?? DEFAULT_AGENT_RUNTIME;
  if (compactRequest && agentRuntimeType !== "pi") {
    throw new Error("当前 Runtime 暂不支持手动压缩。");
  }
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

  const wrappedForwardEvent = (payload: AgentStreamEvent) => {
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
    imageInputCapability,
    visionRelayEnabled,
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
    workspaceId,
    prompt: trimmedText,
    forwardEvent: wrappedForwardEvent,
    attachments: runtimeAttachments,
    permissionMode,
    source,
    target,
    workingDirectory: updatedSession.workingDirectory,
    reasoningLevel,
    toolProvisioningPlan,
    vision: { imageInputCapability, visionRelayEnabled },
  };
  const runPromise = compactRequest
    ? agentExecutionService.compact(runtimeInput)
    : agentExecutionService.execute(runtimeInput);

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
