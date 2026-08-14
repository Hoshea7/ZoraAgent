import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
} from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type {
  AgentStreamEvent,
  AskUserQuestionAnswer,
  FileAttachment,
  PermissionMode,
  PermissionResponse,
  SessionArchiveScope,
  SubtaskBlockedResponse,
} from "../shared/zora";
import { FEISHU_IPC, type FeishuConfig } from "../shared/types/feishu";
import type { DefaultModelSettings } from "../shared/types/default-model";
import type { MemorySettings } from "../shared/types/memory";
import type { VisionSettings } from "../shared/types/vision";
import type { McpSaveInput, McpServerEntry, McpTransportType } from "../shared/types/mcp";
import type {
  ScheduledTaskSchedule,
  ScheduledTaskStatus,
  ScheduledTaskUpdateInput,
} from "../shared/types/schedule";
import { SESSION_IPC, SUBTASK_IPC } from "../shared/types/ipc";
import {
  isValidScheduleTime,
  isValidScheduleWeekdays,
  normalizeScheduleWeekdays,
} from "../shared/types/schedule";
import type { ImportMethod, ImportResult, ImportSelection } from "../shared/types/skill";
import type {
  ProviderCreateInput,
  ProviderUpdateInput,
  RoleModels,
} from "../shared/types/provider";
import { agentExecutionService } from "./agent-execution-service";
import {
  clearSessionWhitelist,
  answerAskUserQuestion,
  respondToPermission,
  setPermissionMode,
} from "./hitl";
import { memoryAgent } from "./memory-agent";
import { loadMemorySettings, saveMemorySettings } from "./memory-settings";
import { migrateLegacyMemoryIfNeeded } from "./memory-store";
import {
  loadDefaultModelSettings,
  saveDefaultModelSettings,
} from "./default-model-settings";
import { visionSettingsStore } from "./vision-settings";
import {
  feishuBridge,
  loadFeishuConfig,
  saveFeishuConfig,
  testFeishuConnection,
} from "./feishu";
import { forkSessionFromSource } from "./session-fork";
import {
  compactSessionContext,
  revisePromptInSession,
  runPromptInSession,
} from "./session-runner";
import { delegationCoordinator, setDelegationEventEmitter } from "./delegation/service";
import { providerManager } from "./provider-manager";
import { McpManager, setSharedMcpManager } from "./mcp-manager";
import { listDirectory, startFileWatcher, stopFileWatcher } from "./file-tree";
import {
  appendMessageRecord,
  archiveSession,
  createSession,
  deleteSession,
  getSessionMeta,
  getSessionJsonlPath,
  listArchivedSessions,
  listSessions,
  loadMessages,
  migrateSessionsIfNeeded,
  projectSavedAttachments,
  renameSession,
  recoverDelegationState,
  restoreSession,
  saveAttachments,
  updateSessionMeta,
} from "./session-store";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  renameWorkspace,
} from "./workspace-store";
import {
  deleteScheduledTask,
  getScheduledTask,
  listAllScheduledTasks,
  listScheduledTasks,
  onScheduledTasksStoreChanged,
  updateScheduledTask,
} from "./schedule-store";
import { startScheduleRunner } from "./schedule-runner";
import { warmupPiRuntime } from "./runtime/pi-session-bridge";
import { agentRuntimeRouter } from "./runtime";
import { DEFAULT_AGENT_RUNTIME } from "./runtime/types";
import { flushDiagnosticLogWrites } from "./diagnostic-log";
import { getErrorMessage, logSystemEvent, type SystemLogLevel } from "./system-log";
import {
  GLOBAL_SKILLS_DIR,
  listSkills,
  seedBundledSkills,
  uninstallSkill,
} from "./skill-manager";
import {
  discoverExternalSkills,
  importSkill,
  importSkills,
  listExternalTools,
} from "./skill-discovery";
import { getPackagedSafeWorkingDirectory, getSDKRuntimeOptions } from "./sdk-runtime";
import {
  checkForUpdates,
  cleanupAutoUpdater,
  downloadUpdate,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  isInstallingUpdate,
} from "./updater";
import { normalizeExternalUrl } from "./external-url";
import { isRecord } from "./utils/guards";
import {
  assertOptionalBoolean,
  assertOptionalString,
  assertRequiredBoolean,
  assertRequiredString,
  normalizeOptionalString,
} from "./utils/validate";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEV_ELECTRON_PROFILE_DIR_NAME = "zora-dev";
let stopScheduleRunner: (() => void) | null = null;

function configureDevElectronProfilePath() {
  if (!isDev) {
    return;
  }

  const devProfilePath = path.join(app.getPath("appData"), DEV_ELECTRON_PROFILE_DIR_NAME);
  mkdirSync(devProfilePath, { recursive: true });
  app.setPath("userData", devProfilePath);
}

configureDevElectronProfilePath();

async function openExternalUrl(url: unknown) {
  await shell.openExternal(normalizeExternalUrl(url));
}

function configureExternalNavigation(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url).catch((error) => {
      logSystemEvent(
        "app",
        "navigation",
        "external:error",
        "打开外部链接失败",
        { url, error: getErrorMessage(error) },
        { level: "warn" }
      );
    });

    return { action: "deny" };
  });
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "ask" || value === "smart" || value === "yolo";
}

function resolveWorkspaceId(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "default";
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("A valid workspaceId is required.");
  }

  return value.trim();
}

function normalizeOptionalWorkspaceId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return resolveWorkspaceId(value);
}

function parseSystemLogLevel(value: unknown): SystemLogLevel {
  return value === "warn" || value === "error" ? value : "info";
}

function resolveProviderSelectionLogFields(
  providerId: string | undefined,
  requestedModelId: string,
  logContext: unknown
): Record<string, unknown> {
  const normalizedRequestedModelId = normalizeOptionalString(requestedModelId);
  const context = isRecord(logContext) ? logContext : {};
  const providerName = normalizeOptionalString(context.provider);
  const providerType = normalizeOptionalString(context.providerType);
  const modelName = normalizeOptionalString(context.model);
  const contextSelectionSource = normalizeOptionalString(context.selectionSource);
  const fallbackModel =
    normalizedRequestedModelId ??
    (providerId ? "(provider default)" : "(unknown)");
  const selectionSource = normalizedRequestedModelId
    ? "selected"
    : "provider_default";

  return {
    provider: providerName ?? providerId ?? "(unknown)",
    providerType,
    model: modelName ?? fallbackModel,
    selectionSource: contextSelectionSource ?? selectionSource,
  };
}

function normalizeClientLogFields(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("fields must be an object when provided.");
  }

  return value;
}

async function findSessionWorkspaceId(sessionId: string): Promise<string | null> {
  const trimmedSessionId = sessionId.trim();
  const workspaces = await listWorkspaces();

  for (const workspace of workspaces) {
    const session = await getSessionMeta(trimmedSessionId, workspace.id);
    if (session) {
      return workspace.id;
    }
  }

  return null;
}

async function resolveExistingSessionWorkspaceId(
  sessionId: string,
  workspaceId?: string
): Promise<{
  workspaceId: string;
  resolvedFrom: "requested" | "search";
}> {
  const trimmedSessionId = sessionId.trim();
  const requestedWorkspaceId = workspaceId ?? "default";
  const requestedSession = await getSessionMeta(
    trimmedSessionId,
    requestedWorkspaceId
  );
  if (requestedSession) {
    return { workspaceId: requestedWorkspaceId, resolvedFrom: "requested" };
  }

  const foundWorkspaceId = await findSessionWorkspaceId(trimmedSessionId);
  if (foundWorkspaceId) {
    return { workspaceId: foundWorkspaceId, resolvedFrom: "search" };
  }

  throw Object.assign(new Error(`Session ${trimmedSessionId} not found.`), {
    code: "SESSION_NOT_FOUND",
  });
}

function hasWorkspaceIdInput(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

async function resolveSessionWorkspaceId(
  sessionId: string,
  workspaceId: unknown
): Promise<string> {
  if (hasWorkspaceIdInput(workspaceId)) {
    return resolveWorkspaceId(workspaceId);
  }

  const workspaces = await listWorkspaces();
  const matches = await Promise.all(
    workspaces.map(async (workspace) => {
      const session = await getSessionMeta(sessionId, workspace.id);
      return session ? workspace.id : null;
    })
  );
  const resolvedWorkspaceId = matches.find(
    (candidate): candidate is string => typeof candidate === "string"
  );

  if (!resolvedWorkspaceId) {
    throw new Error(`Session ${sessionId} not found.`);
  }

  return resolvedWorkspaceId;
}

const ROLE_MODEL_KEYS = [
  "smallFastModel",
  "sonnetModel",
  "opusModel",
  "haikuModel",
] as const;

function parseRoleModelsInput(value: unknown): RoleModels | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("roleModels must be an object when provided.");
  }

  const source = value as Record<string, unknown>;
  const result: Partial<RoleModels> = {};

  for (const key of Object.keys(source)) {
    if (!(ROLE_MODEL_KEYS as readonly string[]).includes(key)) {
      continue;
    }

    const raw = source[key];
    if (raw === undefined || raw === null) {
      continue;
    }

    if (typeof raw !== "string") {
      throw new Error(`roleModels.${key} must be a string.`);
    }

    const normalized = raw.trim();
    if (normalized.length > 0) {
      result[key as keyof RoleModels] = normalized;
    }
  }

  return Object.keys(result).length > 0 ? (result as RoleModels) : undefined;
}

function isMcpTransportType(value: unknown): value is McpTransportType {
  return value === "stdio" || value === "http" || value === "sse" || value === "sdk";
}

function parseMcpServerMutationInput(
  input: unknown
): { name: string; entry: McpServerEntry } {
  if (!isRecord(input)) {
    throw new Error("A valid MCP server payload is required.");
  }

  const name = assertRequiredString(input.name, "mcp.name");

  if (!isRecord(input.entry) || !isMcpTransportType(input.entry.type)) {
    throw new Error("mcp.entry.type must be one of: stdio, http, sse, sdk.");
  }

  return {
    name,
    entry: input.entry as unknown as McpServerEntry,
  };
}

function parseMcpServerNameInput(input: unknown): string {
  if (!isRecord(input)) {
    throw new Error("A valid MCP payload is required.");
  }

  return assertRequiredString(input.name, "mcp.name");
}

function parseMcpToggleInput(input: unknown): { name: string; enabled: boolean } {
  if (!isRecord(input)) {
    throw new Error("A valid MCP toggle payload is required.");
  }

  return {
    name: assertRequiredString(input.name, "mcp.name"),
    enabled: assertRequiredBoolean(input.enabled, "mcp.enabled"),
  };
}

function parseMcpSaveInput(input: unknown): McpSaveInput {
  if (!isRecord(input) || typeof input.mode !== "string") {
    throw new Error("A valid MCP save payload is required.");
  }

  if (input.mode === "entry") {
    const { name, entry } = parseMcpServerMutationInput(input);
    return { mode: "entry", name, entry };
  }

  if (input.mode === "merge-json") {
    return {
      mode: "merge-json",
      json: assertRequiredString(input.json, "mcp.json"),
      fallbackName: assertOptionalString(input.fallbackName, "mcp.fallbackName"),
    };
  }

  if (input.mode === "single-json") {
    return {
      mode: "single-json",
      name: assertRequiredString(input.name, "mcp.name"),
      json: assertRequiredString(input.json, "mcp.json"),
    };
  }

  throw new Error('mcp.mode must be one of: "entry", "merge-json", "single-json".');
}

function isScheduledTaskStatus(value: unknown): value is ScheduledTaskStatus {
  return value === "active" || value === "paused";
}

function parseScheduledTaskSchedule(input: unknown): ScheduledTaskSchedule {
  if (!isRecord(input) || typeof input.type !== "string") {
    throw new Error("A valid schedule payload is required.");
  }

  if (input.type === "once") {
    return {
      type: "once",
      runAt: assertRequiredString(input.runAt, "schedule.runAt").trim(),
    };
  }

  if (input.type === "daily") {
    const time = assertRequiredString(input.time, "schedule.time").trim();

    if (!isValidScheduleTime(time)) {
      throw new Error("schedule.time must use HH:mm format.");
    }

    return {
      type: "daily",
      time,
    };
  }

  if (input.type === "hourly") {
    return {
      type: "hourly",
    };
  }

  if (input.type === "weekdays") {
    const time = assertRequiredString(input.time, "schedule.time").trim();

    if (!isValidScheduleTime(time)) {
      throw new Error("schedule.time must use HH:mm format.");
    }

    return {
      type: "weekdays",
      time,
    };
  }

  if (input.type === "weekly") {
    const time = assertRequiredString(input.time, "schedule.time").trim();
    const weekdays = Array.isArray(input.weekdays) ? input.weekdays : null;

    if (!isValidScheduleTime(time)) {
      throw new Error("schedule.time must use HH:mm format.");
    }

    if (!isValidScheduleWeekdays(weekdays)) {
      throw new Error("schedule.weekdays must contain unique values from 1 to 7.");
    }

    return {
      type: "weekly",
      weekdays: normalizeScheduleWeekdays(weekdays),
      time,
    };
  }

  throw new Error(
    'schedule.type must be one of: "once", "hourly", "daily", "weekdays", "weekly".'
  );
}

function parseScheduledTaskUpdateInput(input: unknown): ScheduledTaskUpdateInput {
  if (!isRecord(input) || !isRecord(input.updates)) {
    throw new Error("A valid scheduled task update payload is required.");
  }

  const updates: ScheduledTaskUpdateInput["updates"] = {};

  if (input.updates.title !== undefined) {
    updates.title = assertRequiredString(input.updates.title, "title").trim();
  }

  if (input.updates.workspaceId !== undefined) {
    updates.workspaceId = assertRequiredString(
      input.updates.workspaceId,
      "workspaceId"
    ).trim();
  }

  if (input.updates.executionPrompt !== undefined) {
    updates.executionPrompt = assertRequiredString(
      input.updates.executionPrompt,
      "executionPrompt"
    ).trim();
  }

  if (input.updates.status !== undefined) {
    if (!isScheduledTaskStatus(input.updates.status)) {
      throw new Error('status must be one of: "active", "paused".');
    }

    updates.status = input.updates.status;
  }

  if (input.updates.schedule !== undefined) {
    updates.schedule = parseScheduledTaskSchedule(input.updates.schedule);
  }

  return {
    taskId: assertRequiredString(input.taskId, "taskId").trim(),
    workspaceId: resolveWorkspaceId(input.workspaceId),
    updates,
  };
}

function emitScheduledTasksChanged(workspaceId: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("schedule:changed", workspaceId);
  }
}

function truncateForPreview(value: string, maxChars = 200): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...(${value.length} chars)`;
}

function summarizeToolUseResult(value: unknown): unknown {
  if (!isRecord(value)) {
    if (typeof value === "string") {
      return truncateForPreview(value);
    }

    return value;
  }

  const summary: Record<string, unknown> = {
    keys: Object.keys(value),
  };

  if (typeof value.type === "string") {
    summary.type = value.type;
  }

  if (typeof value.filePath === "string") {
    summary.filePath = value.filePath;
  }

  if (typeof value.file_path === "string") {
    summary.file_path = value.file_path;
  }

  if ("content" in value) {
    const content =
      typeof value.content === "string"
        ? value.content
        : JSON.stringify(value.content ?? "");
    summary.contentLength = content.length;
    summary.contentPreview = truncateForPreview(content);
  }

  if (Array.isArray(value.structuredPatch)) {
    summary.structuredPatchCount = value.structuredPatch.length;
  }

  if (typeof value.originalFile === "string") {
    summary.originalFileLength = value.originalFile.length;
  }

  return summary;
}

function stripAssistantToolInputs(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return message;
  }

  let changed = false;
  const compactContent = message.content.map((block) => {
    if (!isRecord(block) || block.type !== "tool_use" || !("input" in block)) {
      return block;
    }

    changed = true;
    const { input: _input, ...rest } = block;
    return rest;
  });

  if (!changed) {
    return message;
  }

  return {
    ...message,
    content: compactContent,
  };
}

function compactEventForRenderer(payload: AgentStreamEvent): AgentStreamEvent {
  if (!isRecord(payload)) {
    return payload;
  }

  if (payload.type === "user" && "tool_use_result" in payload) {
    return {
      ...payload,
      tool_use_result: summarizeToolUseResult(payload.tool_use_result),
    };
  }

  if (payload.type === "assistant" && "message" in payload) {
    const compactMessage = stripAssistantToolInputs(payload.message);
    if (compactMessage !== payload.message) {
      return {
        ...payload,
        message: compactMessage,
      };
    }
  }

  return payload;
}

function broadcastAgentStreamEvent(sessionId: string, payload: AgentStreamEvent) {
  const eventPayload = {
    ...compactEventForRenderer(payload),
    sessionId,
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }

    window.webContents.send("agent:stream", eventPayload);
  }
}

setDelegationEventEmitter((event) => {
  if (event.sessionId) {
    broadcastAgentStreamEvent(event.sessionId, event);
  }
});

function parseProviderCreateInput(input: unknown): ProviderCreateInput {
  if (!isRecord(input)) {
    throw new Error("A valid provider payload is required.");
  }

  const raw = input;

  return {
    name: assertRequiredString(input.name, "provider.name"),
    providerType: assertRequiredString(input.providerType, "provider.providerType") as ProviderCreateInput["providerType"],
    baseUrl: assertRequiredString(input.baseUrl, "provider.baseUrl"),
    apiKey: assertRequiredString(input.apiKey, "provider.apiKey"),
    modelId: assertOptionalString(input.modelId, "provider.modelId"),
    presetId: assertOptionalString(
      input.presetId,
      "provider.presetId"
    ) as ProviderCreateInput["presetId"],
    protocol: assertOptionalString(
      input.protocol,
      "provider.protocol"
    ) as ProviderCreateInput["protocol"],
    roleModels: parseRoleModelsInput(raw.roleModels),
    contextWindow:
      typeof raw.contextWindow === "number" ? raw.contextWindow : undefined,
  };
}

function parseSubtaskBlockedResponse(input: unknown): SubtaskBlockedResponse {
  if (!isRecord(input) || (input.type !== "permission" && input.type !== "ask_user")) {
    throw new Error("A valid delegation response is required.");
  }
  if (input.type === "permission") {
    if (input.behavior !== "allow" && input.behavior !== "deny") {
      throw new Error("permission behavior must be allow or deny.");
    }
    return {
      type: "permission",
      behavior: input.behavior,
      alwaysAllow: assertOptionalBoolean(input.alwaysAllow, "alwaysAllow"),
      userMessage:
        typeof input.userMessage === "string" ? input.userMessage.slice(0, 2_000) : undefined,
    };
  }
  if (!isRecord(input.answers)) {
    throw new Error("ask_user answers are required.");
  }
  const answers = Object.fromEntries(
    Object.entries(input.answers).map(([key, value]) => {
      if (typeof value !== "string") throw new Error("Each answer must be a string.");
      return [key, value];
    })
  );
  if (Object.values(answers).reduce((sum, value) => sum + value.length, 0) > 10_000) {
    throw new Error("ask_user answers exceed the 10,000 character limit.");
  }
  return { type: "ask_user", answers };
}

function parseProviderUpdateInput(input: unknown): ProviderUpdateInput {
  if (!isRecord(input)) {
    throw new Error("A valid provider payload is required.");
  }

  const raw = input;

  return {
    name: assertOptionalString(input.name, "provider.name"),
    providerType: assertOptionalString(
      input.providerType,
      "provider.providerType"
    ) as ProviderUpdateInput["providerType"],
    baseUrl: assertOptionalString(input.baseUrl, "provider.baseUrl"),
    apiKey: assertOptionalString(input.apiKey, "provider.apiKey"),
    modelId: assertOptionalString(input.modelId, "provider.modelId"),
    presetId: assertOptionalString(
      input.presetId,
      "provider.presetId"
    ) as ProviderUpdateInput["presetId"],
    protocol: assertOptionalString(
      input.protocol,
      "provider.protocol"
    ) as ProviderUpdateInput["protocol"],
    enabled: assertOptionalBoolean(input.enabled, "provider.enabled"),
    contextWindow:
      typeof raw.contextWindow === "number" ? raw.contextWindow : undefined,
    ...("roleModels" in raw
      ? {
          roleModels: parseRoleModelsInput(raw.roleModels),
        }
      : {}),
  };
}

function parseFeishuConnectionInput(input: unknown): { appId: string; appSecret: string } {
  if (!isRecord(input)) {
    throw new Error("A valid feishu test payload is required.");
  }

  return {
    appId: assertRequiredString(input.appId, "feishu.appId"),
    appSecret: assertRequiredString(input.appSecret, "feishu.appSecret"),
  };
}

function parseOptionalFeishuConfigInput(input: unknown): FeishuConfig | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isRecord(input)) {
    throw new Error("A valid feishu config payload is required.");
  }

  return input as unknown as FeishuConfig;
}

function isMemoryMode(value: unknown): value is MemorySettings["mode"] {
  return value === "immediate" || value === "batch" || value === "manual";
}

function parseMemorySettingsUpdateInput(input: unknown): Partial<MemorySettings> {
  if (!isRecord(input)) {
    throw new Error("A valid memory settings payload is required.");
  }

  const updates: Partial<MemorySettings> = {};

  if ("enabled" in input) {
    const enabled = assertOptionalBoolean(input.enabled, "memory.enabled");
    if (enabled !== undefined) {
      updates.enabled = enabled;
    }
  }

  if ("mode" in input) {
    if (!isMemoryMode(input.mode)) {
      throw new Error("memory.mode must be immediate, batch, or manual.");
    }
    updates.mode = input.mode;
  }

  if ("batchIdleMinutes" in input) {
    const batchIdleMinutes = input.batchIdleMinutes;
    if (
      typeof batchIdleMinutes !== "number" ||
      !Number.isInteger(batchIdleMinutes) ||
      ![1, 10, 20, 30, 60, 120].includes(batchIdleMinutes)
    ) {
      throw new Error("memory.batchIdleMinutes must be one of 1, 10, 20, 30, 60, 120.");
    }
    updates.batchIdleMinutes = batchIdleMinutes;
  }

  if ("memoryProviderId" in input) {
    const { memoryProviderId } = input;
    if (memoryProviderId !== null && typeof memoryProviderId !== "string") {
      throw new Error("memory.memoryProviderId must be a string or null.");
    }
    const normalizedProviderId =
      typeof memoryProviderId === "string" ? memoryProviderId.trim() : memoryProviderId;
    updates.memoryProviderId =
      typeof normalizedProviderId === "string" && normalizedProviderId.length === 0
        ? null
        : normalizedProviderId;
  }

  if ("memoryModelId" in input) {
    const { memoryModelId } = input;
    if (memoryModelId !== null && typeof memoryModelId !== "string") {
      throw new Error("memory.memoryModelId must be a string or null.");
    }
    const normalizedModelId =
      typeof memoryModelId === "string" ? memoryModelId.trim() : memoryModelId;
    updates.memoryModelId =
      typeof normalizedModelId === "string" && normalizedModelId.length === 0
        ? null
        : normalizedModelId;
  }

  return updates;
}

function parseDefaultModelSettingsUpdateInput(
  input: unknown
): Partial<DefaultModelSettings> {
  if (!isRecord(input)) {
    throw new Error("A valid default model settings payload is required.");
  }

  const updates: Partial<DefaultModelSettings> = {};

  if ("defaultProviderId" in input) {
    const { defaultProviderId } = input;
    if (defaultProviderId !== null && typeof defaultProviderId !== "string") {
      throw new Error("defaultModel.defaultProviderId must be a string or null.");
    }
    const normalizedProviderId =
      typeof defaultProviderId === "string" ? defaultProviderId.trim() : defaultProviderId;
    updates.defaultProviderId =
      typeof normalizedProviderId === "string" && normalizedProviderId.length === 0
        ? null
        : normalizedProviderId;
  }

  if ("defaultModelId" in input) {
    const { defaultModelId } = input;
    if (defaultModelId !== null && typeof defaultModelId !== "string") {
      throw new Error("defaultModel.defaultModelId must be a string or null.");
    }
    const normalizedModelId =
      typeof defaultModelId === "string" ? defaultModelId.trim() : defaultModelId;
    updates.defaultModelId =
      typeof normalizedModelId === "string" && normalizedModelId.length === 0
        ? null
        : normalizedModelId;
  }

  return updates;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;
const DOCUMENT_EXTENSIONS = ["pdf"] as const;
const TEXT_EXTENSIONS = [
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "py",
  "js",
  "ts",
  "tsx",
  "jsx",
  "html",
  "css",
  "go",
  "rs",
] as const;
const ALL_SUPPORTED_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...TEXT_EXTENSIONS,
];
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS.map((extension) => `.${extension}`));
const DOCUMENT_EXTENSION_SET = new Set(
  DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`)
);
const TEXT_EXTENSION_SET = new Set(TEXT_EXTENSIONS.map((extension) => `.${extension}`));
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".jsx": "text/jsx",
  ".html": "text/html",
  ".css": "text/css",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
};

function getAttachmentCategory(
  extension: string
): FileAttachment["category"] | null {
  if (IMAGE_EXTENSION_SET.has(extension)) {
    return "image";
  }

  if (DOCUMENT_EXTENSION_SET.has(extension)) {
    return "document";
  }

  if (TEXT_EXTENSION_SET.has(extension)) {
    return "text";
  }

  return null;
}

function buildFileAttachment(filePath: string): FileAttachment | null {
  try {
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = MIME_MAP[extension];
    const category = getAttachmentCategory(extension);

    if (!mimeType || !category) {
      return null;
    }

    const stats = statSync(filePath);

    if (!stats.isFile() || stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return null;
    }

    const attachment: FileAttachment = {
      id: randomUUID(),
      name: path.basename(filePath),
      category,
      mimeType,
      size: stats.size,
      localPath: filePath,
    };

    if (category === "image") {
      attachment.base64Data = readFileSync(filePath).toString("base64");
    }

    return attachment;
  } catch (error) {
    logSystemEvent(
      "app",
      "attachment",
      "prepare:error",
      "准备附件失败",
      { path: filePath, error: getErrorMessage(error) },
      { level: "warn" }
    );
    return null;
  }
}

let isQuitting = false;
function createWindow() {
  const isE2E = process.env.ZORA_E2E === "1";
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f5f3f0",
    titleBarStyle: "hiddenInset",
    show: !isE2E,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), "dist", "main", "preload.js")
    }
  });

  if (isE2E) {
    window.once("ready-to-show", () => window.showInactive());
  }

  configureExternalNavigation(window);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
    initAutoUpdater();
    return;
  }

  window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"));
  initAutoUpdater();
}

app.whenReady().then(async () => {
  await migrateSessionsIfNeeded();
  await recoverDelegationState();
  const memorySettings = await loadMemorySettings();
  if (memorySettings.enabled) {
    try {
      const migrationResult = await migrateLegacyMemoryIfNeeded();
      if (migrationResult.migrated.length > 0) {
        logSystemEvent(
          "app",
          "memory",
          "legacy:migrate",
          "已迁移旧版记忆文件",
          { files: migrationResult.migrated }
        );
      }
    } catch (error) {
      logSystemEvent(
        "app",
        "memory",
        "legacy:migrate:error",
        "迁移旧版记忆文件失败",
        { error: getErrorMessage(error) },
        { level: "error" }
      );
    }
  }
  await seedBundledSkills();
  const mcpManager = setSharedMcpManager(new McpManager());
  onScheduledTasksStoreChanged(emitScheduledTasksChanged);
  stopScheduleRunner = startScheduleRunner({
    forwardEvent: broadcastAgentStreamEvent,
  });

  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("app:open-external", async (_event, url: unknown) => {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("A valid url is required.");
    }

    await openExternalUrl(url);
  });

  ipcMain.handle("diagnostic-log:client-event", async (_event, input: unknown) => {
    if (!isRecord(input)) {
      throw new Error("A valid diagnostic log input is required.");
    }

    const area = assertRequiredString(input.area, "area").trim();
    const component = assertRequiredString(input.component, "component").trim();
    const event = assertRequiredString(input.event, "event").trim();
    const message = assertRequiredString(input.message, "message").trim();
    const level = parseSystemLogLevel(input.level);
    const fields = normalizeClientLogFields(input.fields);

    logSystemEvent(area, component, event, message, fields, { level });
  });

  ipcMain.handle("updater:get-status", () => {
    return getUpdateStatus();
  });

  ipcMain.handle("updater:check", async () => {
    return checkForUpdates();
  });

  ipcMain.handle("updater:download", async () => {
    return downloadUpdate();
  });

  ipcMain.handle("updater:install", async () => {
    installUpdate();
  });

  ipcMain.handle("provider:list", () => {
    return providerManager.list();
  });

  ipcMain.handle("provider:create", async (_event, input: unknown) => {
    return providerManager.create(parseProviderCreateInput(input));
  });

  ipcMain.handle("provider:update", async (_event, id: unknown, input: unknown) => {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    return providerManager.update(id, parseProviderUpdateInput(input));
  });

  ipcMain.handle("provider:delete", async (_event, id: unknown) => {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    const providerId = id.trim();
    await providerManager.delete(providerId);

    const defaultModelSettings = await loadDefaultModelSettings();
    if (defaultModelSettings.defaultProviderId === providerId) {
      await saveDefaultModelSettings({
        ...defaultModelSettings,
        defaultProviderId: null,
        defaultModelId: null,
      });
    }
  });

  ipcMain.handle("provider:set-default", async (_event, providerId: unknown) => {
    if (typeof providerId !== "string" || providerId.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    await providerManager.setDefault(providerId);
  });

  ipcMain.handle("provider:get-api-key", async (_event, providerId: unknown) => {
    if (typeof providerId !== "string" || providerId.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    return providerManager.decryptApiKey(providerId);
  });

  ipcMain.handle("provider:has-configured", () => {
    return providerManager.hasConfigured();
  });

  ipcMain.handle(
    "provider:test",
    async (
      _event,
      baseUrl: unknown,
      apiKey: unknown,
      modelId?: unknown,
      testRunId?: unknown,
      protocol?: unknown
    ) => {
      if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
        throw new Error("A valid baseUrl is required.");
      }
      if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
        throw new Error("A valid apiKey is required.");
      }
      if (modelId !== undefined && typeof modelId !== "string") {
        throw new Error("modelId must be a string when provided.");
      }
      if (testRunId !== undefined && typeof testRunId !== "string") {
        throw new Error("testRunId must be a string when provided.");
      }
      if (
        protocol !== undefined &&
        protocol !== "anthropic-messages" &&
        protocol !== "openai-completions"
      ) {
        throw new Error("protocol must be a supported provider protocol.");
      }

      return providerManager.testConnection(
        baseUrl,
        apiKey,
        modelId as string | undefined,
        testRunId as string | undefined,
        protocol as ProviderCreateInput["protocol"]
      );
    }
  );

  ipcMain.handle(
    "provider:test-with-roles",
    async (
      _event,
      baseUrl: unknown,
      apiKey: unknown,
      modelId?: unknown,
      roleModels?: unknown,
      testRunId?: unknown,
      protocol?: unknown
    ) => {
      if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
        throw new Error("A valid baseUrl is required.");
      }
      if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
        throw new Error("A valid apiKey is required.");
      }
      if (modelId !== undefined && typeof modelId !== "string") {
        throw new Error("modelId must be a string when provided.");
      }
      if (testRunId !== undefined && typeof testRunId !== "string") {
        throw new Error("testRunId must be a string when provided.");
      }
      if (
        protocol !== undefined &&
        protocol !== "anthropic-messages" &&
        protocol !== "openai-completions"
      ) {
        throw new Error("protocol must be a supported provider protocol.");
      }
      const parsedRoleModels = parseRoleModelsInput(roleModels);

      return providerManager.testConnectionWithRoleModels(
        baseUrl,
        apiKey as string,
        modelId as string | undefined,
        parsedRoleModels,
        testRunId as string | undefined,
        protocol as ProviderCreateInput["protocol"]
      );
    }
  );

  ipcMain.handle("provider:cancel-test", (_event, testRunId: unknown) => {
    if (typeof testRunId !== "string" || testRunId.trim().length === 0) {
      throw new Error("A valid testRunId is required.");
    }

    return providerManager.cancelTestRun(testRunId);
  });

  ipcMain.handle("provider:test-default", () => {
    return providerManager.testDefaultConnection();
  });

  ipcMain.handle(FEISHU_IPC.GET_CONFIG, () => {
    return loadFeishuConfig();
  });

  ipcMain.handle(FEISHU_IPC.SAVE_CONFIG, async (_event, input: unknown) => {
    return saveFeishuConfig(input as FeishuConfig);
  });

  ipcMain.handle(FEISHU_IPC.TEST_CONNECTION, async (_event, input: unknown) => {
    const { appId, appSecret } = parseFeishuConnectionInput(input);
    return testFeishuConnection(appId, appSecret);
  });

  ipcMain.handle(FEISHU_IPC.START_BRIDGE, async (_event, input?: unknown) => {
    return feishuBridge.start(parseOptionalFeishuConfigInput(input));
  });

  ipcMain.handle(FEISHU_IPC.STOP_BRIDGE, async () => {
    await feishuBridge.stop();
  });

  ipcMain.handle(FEISHU_IPC.GET_STATUS, () => {
    return feishuBridge.getStatus();
  });

  ipcMain.handle("memory:getSettings", async () => {
    return loadMemorySettings();
  });

  ipcMain.handle("memory:updateSettings", async (_event, input: unknown) => {
    const current = await loadMemorySettings();
    const updated: MemorySettings = {
      ...current,
      ...parseMemorySettingsUpdateInput(input),
    };
    const savedSettings = await saveMemorySettings(updated);
    if (current.enabled && !savedSettings.enabled) {
      memoryAgent.handleMemoryDisabled();
    }
    return savedSettings;
  });

  ipcMain.handle("default-model:getSettings", async () => {
    return loadDefaultModelSettings();
  });

  ipcMain.handle("vision:getSettings", async () => {
    return visionSettingsStore.load();
  });

  ipcMain.handle("vision:updateSettings", async (_event, input: unknown) => {
    return visionSettingsStore.save(input as VisionSettings);
  });

  ipcMain.handle("default-model:updateSettings", async (_event, input: unknown) => {
    const current = await loadDefaultModelSettings();
    const updated: DefaultModelSettings = {
      ...current,
      ...parseDefaultModelSettingsUpdateInput(input),
    };
    await saveDefaultModelSettings(updated);
    return loadDefaultModelSettings();
  });

  ipcMain.handle("memory:processNow", async () => {
    return memoryAgent.processNow();
  });

  ipcMain.handle("memory:getPendingCount", () => {
    return memoryAgent.getPendingCount();
  });

  ipcMain.handle("memory:getStatus", () => {
    return memoryAgent.getStatus();
  });

  ipcMain.handle("mcp:get-config", () => {
    return mcpManager.getConfig();
  });

  ipcMain.handle("mcp:get-editable-config", () => {
    return mcpManager.getEditableConfig();
  });

  ipcMain.handle("mcp:save", async (_event, input: unknown) => {
    const payload = parseMcpSaveInput(input);

    if (payload.mode === "entry") {
      return {
        mode: "entry" as const,
        config: await mcpManager.addServer(payload.name, payload.entry),
      };
    }

    if (payload.mode === "merge-json") {
      return {
        mode: "merge-json" as const,
        result: await mcpManager.saveRawJson(payload.json, payload.fallbackName),
      };
    }

    return {
      mode: "single-json" as const,
      result: await mcpManager.saveSingleServerJson(payload.name, payload.json),
    };
  });

  ipcMain.handle("mcp:delete-server", async (_event, input: unknown) => {
    const name = parseMcpServerNameInput(input);
    return mcpManager.removeServer(name);
  });

  ipcMain.handle("mcp:toggle-server", async (_event, input: unknown) => {
    const { name, enabled } = parseMcpToggleInput(input);
    return mcpManager.toggleServer(name, enabled);
  });

  ipcMain.handle("mcp:test-server", async (_event, input: unknown) => {
    const { name, entry } = parseMcpServerMutationInput(input);
    return mcpManager.testServer(name, entry);
  });

  ipcMain.handle("skill:list", () => {
    return listSkills();
  });

  ipcMain.handle("skill:open-dir", async () => {
    const error = await shell.openPath(GLOBAL_SKILLS_DIR);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("skill:open-skill-dir", async (_event, dirName: unknown) => {
    if (
      typeof dirName !== "string" ||
      dirName.trim().length === 0 ||
      path.basename(dirName) !== dirName
    ) {
      throw new Error("A valid skill directory name is required.");
    }

    const error = await shell.openPath(path.join(GLOBAL_SKILLS_DIR, dirName));
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("skill:discover", async () => {
    return discoverExternalSkills();
  });

  ipcMain.handle(
    "skill:import",
    async (
      _event,
      sourcePath: unknown,
      method: unknown,
      sourceTool: unknown,
      dirName?: unknown
    ) => {
      if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
        throw new Error("A valid sourcePath is required.");
      }
      if (method !== "symlink" && method !== "copy") {
        throw new Error('method must be "symlink" or "copy".');
      }
      if (typeof sourceTool !== "string" || sourceTool.trim().length === 0) {
        throw new Error("A valid sourceTool is required.");
      }
      const targetDirName =
        dirName !== undefined && dirName !== null
          ? assertRequiredString(dirName, "dirName")
          : undefined;

      return importSkill(
        sourcePath.trim(),
        method as ImportMethod,
        sourceTool.trim(),
        targetDirName
      );
    }
  );

  ipcMain.handle("skill:import-batch", async (_event, selections: unknown) => {
    if (!Array.isArray(selections)) {
      throw new Error("selections must be an array.");
    }

    const validSelections: Array<{ index: number; selection: ImportSelection }> = [];
    const results: Array<ImportResult | null> = new Array(selections.length).fill(null);

    for (const [index, item] of selections.entries()) {
      if (typeof item !== "object" || item === null) {
        results[index] = {
          dirName: `selection-${index + 1}`,
          success: false,
          error: "Each selection must be an object.",
        };
        continue;
      }

      const sel = item as Record<string, unknown>;

      const dirName =
        typeof sel.dirName === "string" && sel.dirName.trim().length > 0
          ? sel.dirName.trim()
          : typeof sel.sourcePath === "string" && sel.sourcePath.trim().length > 0
            ? path.basename(sel.sourcePath.trim())
            : `selection-${index + 1}`;

      if (typeof sel.sourcePath !== "string" || sel.sourcePath.trim().length === 0) {
        results[index] = {
          dirName,
          success: false,
          error: "Each selection requires a valid sourcePath.",
        };
        continue;
      }

      if (sel.method !== "symlink" && sel.method !== "copy") {
        results[index] = {
          dirName,
          success: false,
          error: 'Each selection.method must be "symlink" or "copy".',
        };
        continue;
      }

      if (typeof sel.sourceTool !== "string" || sel.sourceTool.trim().length === 0) {
        results[index] = {
          dirName,
          success: false,
          error: "Each selection requires a valid sourceTool.",
        };
        continue;
      }

      validSelections.push({
        index,
        selection: {
          dirName,
          sourcePath: sel.sourcePath.trim(),
          sourceTool: sel.sourceTool.trim(),
          method: sel.method,
        },
      });
    }

    const validResults = await importSkills(validSelections.map((item) => item.selection));
    for (const [resultIndex, result] of validResults.entries()) {
      results[validSelections[resultIndex].index] = result;
    }

    return results.filter((result): result is ImportResult => result !== null);
  });

  ipcMain.handle("skill:uninstall", async (_event, dirName: unknown) => {
    if (
      typeof dirName !== "string" ||
      dirName.trim().length === 0 ||
      path.basename(dirName) !== dirName
    ) {
      throw new Error("A valid skill directory name is required.");
    }
    return uninstallSkill(dirName);
  });

  ipcMain.handle("skill:list-external-tools", () => {
    return listExternalTools();
  });

  ipcMain.handle("workspace:list", async () => {
    return listWorkspaces();
  });

  ipcMain.handle(
    "workspace:create",
    async (_event, name: unknown, workspacePath: unknown) => {
      const workspace = await createWorkspace(
        assertRequiredString(name, "workspace.name").trim(),
        assertRequiredString(workspacePath, "workspace.path").trim()
      );
      logSystemEvent(
        "app",
        "workspace",
        "create",
        "工作区已创建",
        { workspaceId: workspace.id, path: workspace.path }
      );
      return workspace;
    }
  );

  ipcMain.handle("workspace:delete", async (_event, workspaceId: unknown) => {
    const targetWorkspaceId = resolveWorkspaceId(workspaceId);

    if (targetWorkspaceId === "default") {
      throw new Error("Default workspace cannot be deleted.");
    }

    await deleteWorkspace(targetWorkspaceId);
    logSystemEvent(
      "app",
      "workspace",
      "delete",
      "工作区已删除",
      { workspaceId: targetWorkspaceId }
    );
  });

  ipcMain.handle(
    "workspace:rename",
    async (_event, workspaceId: unknown, name: unknown) => {
      const targetWorkspaceId = resolveWorkspaceId(workspaceId);
      const workspace = await renameWorkspace(
        targetWorkspaceId,
        assertRequiredString(name, "workspace.name").trim()
      );
      logSystemEvent(
        "app",
        "workspace",
        "rename",
        "工作区已重命名",
        { workspaceId: targetWorkspaceId, name: workspace.name }
      );
      return workspace;
    }
  );

  ipcMain.handle("workspace:pick-directory", async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options: OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: app.getPath("home"),
    };
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("schedule:list", async (_event, workspaceId: unknown) => {
    if (workspaceId === undefined || workspaceId === null || workspaceId === "") {
      return listAllScheduledTasks();
    }

    return listScheduledTasks(resolveWorkspaceId(workspaceId));
  });

  ipcMain.handle("schedule:update", async (_event, input: unknown) => {
    const payload = parseScheduledTaskUpdateInput(input);
    return updateScheduledTask(payload);
  });

  ipcMain.handle(
    "schedule:get",
    async (_event, taskId: unknown, workspaceId: unknown) => {
      const targetWorkspaceId = resolveWorkspaceId(workspaceId);
      const targetTaskId = assertRequiredString(taskId, "taskId").trim();
      return getScheduledTask(targetTaskId, targetWorkspaceId);
    }
  );

  ipcMain.handle(
    "schedule:delete",
    async (_event, taskId: unknown, workspaceId: unknown) => {
      const targetWorkspaceId = resolveWorkspaceId(workspaceId);
      const targetTaskId = assertRequiredString(taskId, "taskId").trim();
      await deleteScheduledTask(targetTaskId, targetWorkspaceId);
    }
  );

  ipcMain.handle(
    "filetree:list",
    async (_event, dirPath: unknown, workspacePath: unknown) => {
      const targetDirPath = assertRequiredString(dirPath, "dirPath").trim();
      const targetWorkspacePath = assertRequiredString(
        workspacePath,
        "workspacePath"
      ).trim();

      return listDirectory(targetDirPath, targetWorkspacePath);
    }
  );

  ipcMain.handle("filetree:open-in-finder", async (_event, dirPath: unknown) => {
    const targetDirPath = assertRequiredString(dirPath, "dirPath").trim();
    const error = await shell.openPath(path.resolve(targetDirPath));

    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("filetree:watch", async (_event, workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || workspacePath.trim().length === 0) {
      throw new Error("A valid workspace path is required.");
    }

    const win = BrowserWindow.fromWebContents(_event.sender);
    if (win) {
      startFileWatcher(workspacePath.trim(), win);
    }
  });

  ipcMain.handle("filetree:unwatch", async () => {
    stopFileWatcher();
  });

  ipcMain.handle(SESSION_IPC.LIST, async (_event, workspaceId: unknown) => {
    return listSessions(resolveWorkspaceId(workspaceId));
  });

  ipcMain.handle(SUBTASK_IPC.LIST, async (_event, input: unknown) => {
    if (!isRecord(input)) throw new Error("A delegation scope is required.");
    const scope = {
      workspaceId: resolveWorkspaceId(input.workspaceId),
      parentSessionId: assertRequiredString(
        input.parentSessionId,
        "parentSessionId"
      ).trim(),
    };
    return delegationCoordinator.forScope(scope).list();
  });

  ipcMain.handle(SUBTASK_IPC.GET, async (_event, input: unknown) => {
    if (!isRecord(input)) throw new Error("A delegation reference is required.");
    const scoped = delegationCoordinator.forScope({
      workspaceId: resolveWorkspaceId(input.workspaceId),
      parentSessionId: assertRequiredString(
        input.parentSessionId,
        "parentSessionId"
      ).trim(),
    });
    return scoped.get(assertRequiredString(input.delegationId, "delegationId").trim());
  });

  ipcMain.handle(SUBTASK_IPC.STOP, async (_event, input: unknown) => {
    if (!isRecord(input)) throw new Error("A delegation reference is required.");
    const scoped = delegationCoordinator.forScope({
      workspaceId: resolveWorkspaceId(input.workspaceId),
      parentSessionId: assertRequiredString(
        input.parentSessionId,
        "parentSessionId"
      ).trim(),
    });
    return scoped.stop(
      assertRequiredString(input.delegationId, "delegationId").trim(),
      assertRequiredString(input.expectedRunId, "expectedRunId").trim()
    );
  });

  ipcMain.handle(SUBTASK_IPC.RESPOND, async (_event, input: unknown) => {
    if (!isRecord(input) || !isRecord(input.response)) {
      throw new Error("A delegation response is required.");
    }
    const scoped = delegationCoordinator.forScope({
      workspaceId: resolveWorkspaceId(input.workspaceId),
      parentSessionId: assertRequiredString(
        input.parentSessionId,
        "parentSessionId"
      ).trim(),
    });
    return scoped.respond(
      assertRequiredString(input.delegationId, "delegationId").trim(),
      assertRequiredString(input.blockedEventId, "blockedEventId").trim(),
      parseSubtaskBlockedResponse(input.response)
    );
  });

  ipcMain.handle(SESSION_IPC.LIST_ARCHIVED, async () => {
    return listArchivedSessions();
  });

  ipcMain.handle(SESSION_IPC.CREATE, async (
    _event,
    title: string,
    workspaceId: unknown,
    permissionMode: unknown
  ) => {
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("Session title is required.");
    }

    const mode = permissionMode === undefined ? "ask" : permissionMode;
    if (!isPermissionMode(mode)) {
      throw new Error("Invalid permission mode.");
    }
    return createSession(title.trim(), resolveWorkspaceId(workspaceId), mode);
  });

  ipcMain.handle(
    SESSION_IPC.FORK,
    async (_event, input: unknown) => {
      if (!isRecord(input)) {
        throw new Error("Fork input is required.");
      }

      const targetWorkspaceId = resolveWorkspaceId(input.workspaceId);
      const trimmedSessionId = assertRequiredString(
        input.sourceSessionId,
        "sourceSessionId"
      ).trim();

      if (agentExecutionService.isRunning(trimmedSessionId)) {
        throw new Error("当前会话正在运行，结束后再 Fork。");
      }

      const result = await forkSessionFromSource({
        sourceSessionId: trimmedSessionId,
        workspaceId: targetWorkspaceId,
        title: typeof input.title === "string" ? input.title : undefined,
        upToMessageId:
          typeof input.upToMessageId === "string"
            ? input.upToMessageId
            : undefined,
      });

      logSystemEvent(
        "app",
        "session",
        "fork",
        "会话已 Fork",
        {
          sourceSessionId: trimmedSessionId,
          sessionId: result.session.id,
          workspaceId: targetWorkspaceId,
        }
      );
      return result;
    }
  );

  ipcMain.handle(SESSION_IPC.DELETE, async (_event, sessionId: unknown, workspaceId: unknown) => {
    const targetSessionId = assertRequiredString(sessionId, "sessionId").trim();
    const targetWorkspaceId = resolveWorkspaceId(workspaceId);
    const sessions = await listSessions(targetWorkspaceId, { includeArchived: true });
    const target = sessions.find((session) => session.id === targetSessionId);
    const children = target?.parentSessionId
      ? [target]
      : sessions.filter((session) => session.parentSessionId === targetSessionId);
    for (const child of children) {
      if (child.delegationStatus === "running" && child.delegationRunId && child.parentSessionId) {
        await delegationCoordinator
          .forScope({ workspaceId: targetWorkspaceId, parentSessionId: child.parentSessionId })
          .stop(child.id, child.delegationRunId);
      }
    }
    if (agentExecutionService.isRunning(targetSessionId)) {
      await agentExecutionService.stop(targetSessionId);
    }
    const removedSessionIds = target?.parentSessionId
      ? [targetSessionId]
      : [targetSessionId, ...children.map((child) => child.id)];
    await deleteSession(targetSessionId, targetWorkspaceId);
    for (const removedSessionId of removedSessionIds) {
      clearSessionWhitelist(removedSessionId);
    }
    logSystemEvent(
      "app",
      "session",
      "delete",
      "会话已删除",
      { sessionId: targetSessionId, workspaceId: targetWorkspaceId }
    );
  });

  ipcMain.handle(SESSION_IPC.ARCHIVE, async (
    _event,
    sessionId: unknown,
    workspaceId: unknown,
    scope: unknown
  ) => {
    const targetSessionId = assertRequiredString(sessionId, "sessionId").trim();
    if (scope !== undefined && scope !== "session" && scope !== "family") {
      throw new Error("archive scope must be session or family.");
    }
    const archiveScope: SessionArchiveScope = scope ?? "session";
    const targetWorkspaceId = resolveWorkspaceId(workspaceId);
    const sessions = await listSessions(targetWorkspaceId, { includeArchived: true });
    const target = sessions.find((session) => session.id === targetSessionId);
    if (!target) {
      throw new Error(`Session ${targetSessionId} not found.`);
    }
    const rootSessionId = target.parentSessionId ?? target.id;
    const selected = target.parentSessionId && archiveScope === "session"
      ? [target]
      : sessions.filter(
          (session) => session.id === rootSessionId || session.parentSessionId === rootSessionId
        );

    if (selected.some((session) => agentExecutionService.isRunning(session.id))) {
      throw new Error("当前会话正在运行，结束后再归档。");
    }
    const archived = await archiveSession(
      targetSessionId,
      targetWorkspaceId,
      archiveScope
    );

    logSystemEvent(
      "app",
      "session",
      "archive",
      "会话已归档",
      { sessionId: targetSessionId, workspaceId: targetWorkspaceId }
    );
    return archived;
  });

  ipcMain.handle(SESSION_IPC.RESTORE, async (_event, sessionId: unknown, workspaceId: unknown) => {
    const targetSessionId = assertRequiredString(sessionId, "sessionId").trim();

    const targetWorkspaceId = resolveWorkspaceId(workspaceId);
    const restored = await restoreSession(
      targetSessionId,
      targetWorkspaceId
    );
    logSystemEvent(
      "app",
      "session",
      "restore",
      "归档会话已恢复",
      { sessionId: targetSessionId, workspaceId: targetWorkspaceId }
    );
    return restored;
  });

  ipcMain.handle(
    SESSION_IPC.RENAME,
    async (_event, sessionId: unknown, title: unknown, workspaceId: unknown) => {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (typeof title !== "string" || title.trim().length === 0) {
        throw new Error("A non-empty title is required.");
      }

      const nextTitle = title.trim();
      await renameSession(sessionId, nextTitle, resolveWorkspaceId(workspaceId));
      logSystemEvent(
        "app",
        "session",
        "rename",
        "会话已重命名",
        { sessionId, title: nextTitle }
      );
    }
  );

  ipcMain.handle(
    SESSION_IPC.LOAD_MESSAGES,
    async (_event, sessionId: string, workspaceId: unknown) => {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("Session ID is required.");
      }

      return loadMessages(sessionId, resolveWorkspaceId(workspaceId));
    }
  );

  ipcMain.handle(
    SESSION_IPC.REVISE_USER_MESSAGE,
    async (_event, input: unknown) => {
      if (!isRecord(input)) {
        throw new Error("Message revision input is required.");
      }

      const sessionId = assertRequiredString(input.sessionId, "sessionId").trim();
      const messageId = assertRequiredString(input.messageId, "messageId").trim();
      if (typeof input.text !== "string") {
        throw new Error("Message text must be a string.");
      }
      const workspaceId = resolveWorkspaceId(input.workspaceId);
      const result = await revisePromptInSession({
        sessionId,
        workspaceId,
        messageId,
        text: input.text,
        forwardEvent: (payload) => {
          broadcastAgentStreamEvent(sessionId, payload);
        },
      });

      logSystemEvent(
        "app",
        "session",
        "message:revise",
        "用户消息已修改并重新发送",
        { sessionId, messageId, workspaceId }
      );
      return result;
    }
  );

  ipcMain.handle(
    SESSION_IPC.GET_FILE_PATH,
    async (_event, sessionId: unknown, workspaceId: unknown) => {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("Session ID is required.");
      }

      return getSessionJsonlPath(sessionId, resolveWorkspaceId(workspaceId));
    }
  );

  ipcMain.handle(
    SESSION_IPC.LOCK_MODEL,
    async (
      _event,
      sessionId: unknown,
      providerId: unknown,
      modelId: unknown,
      workspaceId: unknown,
      logContext: unknown
    ) => {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (typeof providerId !== "string" || providerId.trim().length === 0) {
        throw new Error("A valid providerId is required.");
      }
      if (typeof modelId !== "string") {
        throw new Error("modelId must be a string.");
      }

      const targetSessionId = sessionId.trim();
      const requestedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);
      const targetProviderId = providerId.trim();
      const trimmedModelId = modelId.trim();
      const providerSelectionLogFields = resolveProviderSelectionLogFields(
        targetProviderId,
        trimmedModelId,
        logContext
      );

      logSystemEvent(
        "ipc",
        "session",
        "lock-model:request",
        "发送前锁定会话模型",
        {
          sessionId: targetSessionId,
          requestedWorkspaceId: requestedWorkspaceId ?? "default",
          ...providerSelectionLogFields,
        }
      );

      try {
        const resolved = await resolveExistingSessionWorkspaceId(
          targetSessionId,
          requestedWorkspaceId
        );

        await updateSessionMeta(
          targetSessionId,
          {
            providerId: targetProviderId,
            providerLocked: true,
            selectedModelId: trimmedModelId.length > 0 ? trimmedModelId : undefined,
          },
          resolved.workspaceId
        );

        logSystemEvent(
          "ipc",
          "session",
          "lock-model:success",
          "会话模型已锁定",
          {
            sessionId: targetSessionId,
            requestedWorkspaceId: requestedWorkspaceId ?? "default",
            resolvedWorkspaceId: resolved.workspaceId,
            resolvedFrom: resolved.resolvedFrom,
            ...providerSelectionLogFields,
          }
        );

        return { success: true };
      } catch (error) {
        const foundWorkspaceId = await findSessionWorkspaceId(targetSessionId).catch(
          () => null
        );
        logSystemEvent(
          "ipc",
          "session",
          "lock-model:error",
          "会话模型锁定失败",
          {
            sessionId: targetSessionId,
            requestedWorkspaceId: requestedWorkspaceId ?? "default",
            foundInOtherWorkspace:
              Boolean(foundWorkspaceId) &&
              foundWorkspaceId !== (requestedWorkspaceId ?? "default"),
            foundWorkspaceId,
            code:
              typeof error === "object" && error !== null && "code" in error
                ? (error as { code?: string }).code
                : undefined,
            ...providerSelectionLogFields,
            error: getErrorMessage(error),
          },
          { level: "error" }
        );
        throw error;
      }
    }
  );

  ipcMain.handle(
    SESSION_IPC.SWITCH_MODEL,
    async (
      _event,
      sessionId: unknown,
      modelId: unknown,
      workspaceId: unknown,
      logContext: unknown
    ) => {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (typeof modelId !== "string") {
        throw new Error("modelId must be a string.");
      }

      const targetSessionId = sessionId.trim();
      const requestedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);
      const trimmedModelId = modelId.trim();

      try {
        const resolved = await resolveExistingSessionWorkspaceId(
          targetSessionId,
          requestedWorkspaceId
        );
        const session = await getSessionMeta(targetSessionId, resolved.workspaceId);
        const providerSelectionLogFields = resolveProviderSelectionLogFields(
          session?.providerId,
          trimmedModelId,
          logContext
        );

        logSystemEvent(
          "ipc",
          "session",
          "switch-model:request",
          "发送前切换会话模型",
          {
            sessionId: targetSessionId,
            requestedWorkspaceId: requestedWorkspaceId ?? "default",
            resolvedWorkspaceId: resolved.workspaceId,
            resolvedFrom: resolved.resolvedFrom,
            ...providerSelectionLogFields,
          }
        );

        await updateSessionMeta(
          targetSessionId,
          {
            selectedModelId: trimmedModelId.length > 0 ? trimmedModelId : undefined,
          },
          resolved.workspaceId
        );

        logSystemEvent(
          "ipc",
          "session",
          "switch-model:success",
          "会话模型已切换",
          {
            sessionId: targetSessionId,
            requestedWorkspaceId: requestedWorkspaceId ?? "default",
            resolvedWorkspaceId: resolved.workspaceId,
            resolvedFrom: resolved.resolvedFrom,
            ...providerSelectionLogFields,
          }
        );

        return { success: true };
      } catch (error) {
        const foundWorkspaceId = await findSessionWorkspaceId(targetSessionId).catch(
          () => null
        );
        const foundSession = foundWorkspaceId
          ? await getSessionMeta(targetSessionId, foundWorkspaceId).catch(() => null)
          : null;
        const providerSelectionLogFields = resolveProviderSelectionLogFields(
          foundSession?.providerId,
          trimmedModelId,
          logContext
        );
        logSystemEvent(
          "ipc",
          "session",
          "switch-model:error",
          "会话模型切换失败",
          {
            sessionId: targetSessionId,
            requestedWorkspaceId: requestedWorkspaceId ?? "default",
            foundInOtherWorkspace:
              Boolean(foundWorkspaceId) &&
              foundWorkspaceId !== (requestedWorkspaceId ?? "default"),
            foundWorkspaceId,
            code:
              typeof error === "object" && error !== null && "code" in error
                ? (error as { code?: string }).code
                : undefined,
            ...providerSelectionLogFields,
            error: getErrorMessage(error),
          },
          { level: "error" }
        );
        throw error;
      }
    }
  );

  ipcMain.handle(
    SESSION_IPC.SET_RUNTIME,
    async (
      _event,
      sessionId: unknown,
      agentRuntimeType: unknown,
      workspaceId: unknown
    ) => {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (agentRuntimeType !== "claude" && agentRuntimeType !== "pi") {
        throw new Error("agentRuntimeType must be 'claude' or 'pi'.");
      }

      const targetSessionId = sessionId.trim();
      const requestedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);

      const resolved = await resolveExistingSessionWorkspaceId(
        targetSessionId,
        requestedWorkspaceId
      );
      const currentSession = await getSessionMeta(
        targetSessionId,
        resolved.workspaceId
      );
      const currentRuntime = currentSession?.agentRuntimeType
        ?? (currentSession?.sdkSessionId ? "claude" : DEFAULT_AGENT_RUNTIME);
      await updateSessionMeta(
        targetSessionId,
        {
          agentRuntimeType,
          ...(currentRuntime === "pi" && agentRuntimeType === "claude"
            ? { sdkSessionId: undefined }
            : {}),
        },
        resolved.workspaceId
      );

      logSystemEvent(
        "ipc",
        "session",
        "set-runtime:success",
        "会话运行时已切换",
        {
          sessionId: targetSessionId,
          agentRuntimeType,
          activeAgentRuntimeType: agentExecutionService.getRunInfo(targetSessionId).agentRuntimeType,
          appliesTo: agentExecutionService.isRunning(targetSessionId) ? "next_run" : "next_send",
          resolvedWorkspaceId: resolved.workspaceId,
        }
      );
    }
  );

  ipcMain.handle(
    SESSION_IPC.SET_REASONING_LEVEL,
    async (
      _event,
      sessionId: unknown,
      reasoningLevel: unknown,
      workspaceId: unknown
    ) => {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (
        reasoningLevel !== "off" &&
        reasoningLevel !== "high" &&
        reasoningLevel !== "max"
      ) {
        throw new Error("reasoningLevel must be one of: off, high, max.");
      }

      const targetSessionId = sessionId.trim();
      const requestedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);
      const resolved = await resolveExistingSessionWorkspaceId(
        targetSessionId,
        requestedWorkspaceId
      );

      await updateSessionMeta(
        targetSessionId,
        { reasoningLevel },
        resolved.workspaceId
      );

      logSystemEvent(
        "ipc",
        "session",
        "set-reasoning-level:success",
        "会话推理强度已切换",
        {
          sessionId: targetSessionId,
          reasoningLevel,
          appliesTo: agentExecutionService.isRunning(targetSessionId) ? "next_run" : "next_send",
          resolvedWorkspaceId: resolved.workspaceId,
        }
      );
    }
  );

  ipcMain.handle(
    SESSION_IPC.COMPACT,
    async (_event, sessionId: unknown, workspaceId: unknown) => {
      const targetSessionId = assertRequiredString(sessionId, "sessionId").trim();
      const resolved = await resolveExistingSessionWorkspaceId(
        targetSessionId,
        normalizeOptionalWorkspaceId(workspaceId)
      );
      return compactSessionContext(
        targetSessionId,
        resolved.workspaceId,
        (payload) => broadcastAgentStreamEvent(targetSessionId, payload)
      );
    }
  );

  ipcMain.handle("dialog:select-files", async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "All Supported", extensions: [...ALL_SUPPORTED_EXTENSIONS] },
        { name: "Images", extensions: [...IMAGE_EXTENSIONS] },
        { name: "Documents", extensions: [...DOCUMENT_EXTENSIONS] },
        { name: "Text & Code", extensions: [...TEXT_EXTENSIONS] },
      ],
    };
    const { canceled, filePaths } = targetWindow
      ? await dialog.showOpenDialog(targetWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (canceled || filePaths.length === 0) {
      return [];
    }

    return filePaths
      .map((filePath) => buildFileAttachment(filePath))
      .filter((attachment): attachment is FileAttachment => attachment !== null);
  });

  ipcMain.handle("file:read-as-attachment", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      return null;
    }

    return buildFileAttachment(filePath);
  });

  ipcMain.handle(
    "agent:chat",
    async (
      _event,
      text: unknown,
      sessionId: unknown,
      userMessageId: unknown,
      workspaceId: unknown,
      attachments?: FileAttachment[]
    ) => {
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("A non-empty prompt is required.");
      }
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (typeof userMessageId !== "string" || userMessageId.trim().length === 0) {
        throw new Error("A valid userMessageId is required.");
      }

      const targetWorkspaceId = resolveWorkspaceId(workspaceId);
      const targetSession = await getSessionMeta(sessionId.trim(), targetWorkspaceId);
      if (
        targetSession?.parentSessionId &&
        targetSession.delegationStatus &&
        targetSession.delegationStatus !== "running" &&
        targetSession.delegationRunId
      ) {
        await delegationCoordinator
          .forScope({
            workspaceId: targetWorkspaceId,
            parentSessionId: targetSession.parentSessionId,
          })
          .continueDelegation(
            targetSession.id,
            targetSession.delegationRunId,
            text.trim(),
            {
              invocationId: `renderer:${randomUUID()}`,
              runtime: targetSession.agentRuntimeType ?? DEFAULT_AGENT_RUNTIME,
              providerId: targetSession.providerId,
              modelId: targetSession.selectedModelId,
              userMessageId: userMessageId.trim(),
            }
          );
        return;
      }

      await runPromptInSession({
        sessionId,
        workspaceId: targetWorkspaceId,
        text,
        attachments,
        userMessageId: userMessageId.trim(),
        source: "desktop",
        forwardEvent: (payload) => {
          broadcastAgentStreamEvent(sessionId, payload);
        },
      });
    }
  );

  ipcMain.handle(
    "agent:queue-message",
    async (
      _event,
      sessionId: unknown,
      text: unknown,
      workspaceId: unknown,
      uuid: unknown,
      attachments?: FileAttachment[]
    ) => {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("A non-empty text is required.");
      }

      const targetSessionId = sessionId.trim();
      const trimmedText = text.trim();
      const targetWorkspaceId = resolveWorkspaceId(workspaceId);
      const requestedUuid =
        typeof uuid === "string" && uuid.trim().length > 0 ? uuid.trim() : undefined;
      const messageUuid = requestedUuid ?? randomUUID();
      const savedAttachments =
        attachments && attachments.length > 0
          ? await saveAttachments(targetSessionId, attachments, targetWorkspaceId)
          : [];
      const runtimeAttachments =
        savedAttachments.length > 0
          ? await projectSavedAttachments(
              targetSessionId,
              savedAttachments,
              targetWorkspaceId
            )
          : undefined;

      await appendMessageRecord(
        targetSessionId,
        {
          kind: "user",
          message: {
            id: `user-${messageUuid}`,
            role: "user",
            text: trimmedText,
            timestamp: Date.now(),
            attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
          },
        },
        targetWorkspaceId
      );
      memoryAgent.scheduleProcessing(targetSessionId, targetWorkspaceId);

      await agentExecutionService.enqueue(targetSessionId, {
        id: messageUuid,
        text: trimmedText,
        attachments: runtimeAttachments,
      });

      return messageUuid;
    }
  );

  ipcMain.handle("agent:stop", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }
    await agentExecutionService.stop(sessionId.trim());
  });

  ipcMain.handle("agent:is-running", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }

    return agentExecutionService.isRunning(sessionId.trim());
  });

  ipcMain.handle("agent:get-run-info", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }

    return agentExecutionService.getRunInfo(sessionId.trim());
  });

  ipcMain.handle(
    "agent:permission-mode:set",
    async (
      _event,
      sessionId: unknown,
      mode: unknown,
      workspaceId: unknown
    ) => {
      const targetSessionId = assertRequiredString(sessionId, "sessionId").trim();
      if (!isPermissionMode(mode)) {
        throw new Error("Invalid permission mode.");
      }
      const resolved = await resolveExistingSessionWorkspaceId(
        targetSessionId,
        normalizeOptionalWorkspaceId(workspaceId)
      );
      await updateSessionMeta(
        targetSessionId,
        { permissionMode: mode },
        resolved.workspaceId
      );
      setPermissionMode(mode, targetSessionId);
    }
  );

  ipcMain.handle(
    "agent:permission:respond",
    async (_event, response: PermissionResponse) => {
      respondToPermission(
        response.requestId,
        response.behavior,
        response.alwaysAllow,
        response.userMessage
      );
    }
  );

  ipcMain.handle(
    "agent:ask-user:respond",
    async (_event, response: AskUserQuestionAnswer) => {
      answerAskUserQuestion(response.requestId, response.answers);
    }
  );

  memoryAgent.setPendingChangeCallback((count) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("memory:pendingChanged", count);
      }
    }
  });

  createWindow();

  // Preload the Pi runtime module graph after first paint so a cold
  // require() of ~500 modules does not block the first agent message.
  setTimeout(() => {
    warmupPiRuntime();
  }, 1200);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  cleanupAutoUpdater();
  stopScheduleRunner?.();
  stopScheduleRunner = null;

  if (isInstallingUpdate()) {
    return;
  }

  if (isQuitting) {
    return;
  }

  isQuitting = true;
  event.preventDefault();

  try {
    await delegationCoordinator.interruptAll();
    await agentExecutionService.dispose();
    await memoryAgent.flushAll();
  } catch (error) {
    logSystemEvent(
      "app",
      "memory",
      "flush:error",
      "退出前刷新记忆失败",
      { error: getErrorMessage(error) },
      { level: "error" }
    );
  } finally {
    await flushDiagnosticLogWrites();
    app.exit();
  }
});
