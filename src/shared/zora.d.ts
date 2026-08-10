import type {
  FeishuBridgeStatus,
  FeishuConfig,
  FeishuConnectionTestResult,
} from "./types/feishu";
import type { MemorySettings } from "./types/memory";
import type { DefaultModelSettings } from "./types/default-model";
import type { ConfiguredModelCapability, VisionSettings } from "./types/vision";
import type { RuntimeProjectionFingerprint } from "./types/vision";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderProtocol,
  ProviderTestResult,
  ProviderTestResultWithRoles,
  ReasoningLevel,
  RoleModels,
  ProviderUpdateInput,
  AgentRuntimeType,
} from "./types/provider";
import type {
  DiscoveryResult,
  ExternalToolConfig,
  ImportMethod,
  ImportResult,
  ImportSelection,
  SkillMeta,
} from "./types/skill";
import type { UpdateStatus } from "./types/updater";
import type {
  McpConfig,
  McpSaveInput,
  McpSaveResult,
  McpServerEntry,
  McpServerTestResult,
} from "./types/mcp";
import type {
  ScheduledTask,
  ScheduledTaskDetailLink,
  ScheduledTaskUpdateInput,
} from "./types/schedule";

export type { SkillMeta };
export type { AgentRuntimeType, ReasoningLevel } from "./types/provider";
export type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskDetailLink,
  ScheduledTaskSchedule,
  ScheduledTaskStatus,
  ScheduledTaskUpdateInput,
} from "./types/schedule";

export type AgentStatus = "started" | "finished" | "stopped";
export type AgentRunSource = "desktop" | "feishu" | "schedule" | "memory";
export interface AgentRunInfo {
  running: boolean;
  source?: AgentRunSource;
  agentRuntimeType?: AgentRuntimeType;
}
export type PermissionMode = "ask" | "smart" | "yolo";

export interface FileAttachment {
  id: string;
  name: string;
  category: "image" | "document" | "text";
  mimeType: string;
  size: number;
  localPath: string;
  base64Data?: string;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  sdkSessionId?: string;
  providerId?: string;
  providerLocked?: boolean;
  selectedModelId?: string;
  workingDirectory?: string;
  branch?: SessionBranchMeta;
  agentRuntimeType?: AgentRuntimeType;
  reasoningLevel?: ReasoningLevel;
  runtimeProjectionFingerprint?: RuntimeProjectionFingerprint;
}

export interface ArchivedSessionEntry {
  session: SessionMeta;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
}

export interface SessionBranchMeta {
  sourceSessionId: string;
  sourceSdkSessionId?: string;
  forkedAt: string;
  forkMode: "full" | "message";
  forkedFromMessageId?: string;
  inheritedMessageCount: number;
}

export interface SessionForkResult {
  session: SessionMeta;
  messages: ConversationMessage[];
}

export interface SessionForkRequest {
  sourceSessionId: string;
  title?: string;
  upToMessageId?: string;
}

export interface ForkSessionInput extends SessionForkRequest {
  workspaceId?: string;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolAction {
  id: string;
  name: string;
  input: string;
  result?: string;
  status: "running" | "done" | "error";
  startedAt: number;
  completedAt?: number;
}

export interface ThinkingBlock {
  id: string;
  content: string;
  startedAt: number;
  completedAt?: number;
}

export type ProcessStep =
  | { type: "thinking"; thinking: ThinkingBlock }
  | { type: "tool"; tool: ToolAction };

export interface BodySegment {
  id: string;
  text: string;
}

export type AssistantAction = {
  type: "schedule-task-link";
  link: ScheduledTaskDetailLink;
};

export interface AssistantTurn {
  id: string;
  processSteps: ProcessStep[];
  bodySegments: BodySegment[];
  actions?: AssistantAction[];
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  attachments?: FileAttachment[];
  queueState?: "pending" | "accepted";
  queueUuid?: string;
  turn?: AssistantTurn;
  timestamp: number;
}

export type AgentControlEvent =
  | {
      type: "agent_status";
      status: AgentStatus;
      source?: AgentRunSource;
    }
  | {
      type: "agent_error";
      error: string;
    }
  | {
      type: "queued_message_accepted";
      uuid: string;
    }
  | {
      type: "queued_message_started";
      uuid: string;
    };

export interface ClientLogEventInput {
  area: string;
  component: string;
  event: string;
  message: string;
  level?: "info" | "warn" | "error";
  fields?: Record<string, unknown>;
}

export interface SessionModelLogContext {
  provider?: string;
  providerType?: string;
  model?: string;
  selectionSource?: "selected" | "provider_default";
}

// ═══════════════════════════════════════════════════════════
// HITL (Human-in-the-Loop) 类型
// 用于 Main ↔ Renderer 双向通信的权限审批与用户提问机制
// ═══════════════════════════════════════════════════════════

/** 权限请求：Main → Renderer 推送，Agent 运行中某个工具需要用户审批 */
export interface PermissionRequest {
  requestId: string; // 唯一标识，格式 perm-{timestamp}-{counter}
  toolName: string; // 工具名，如 "Bash", "Write", "Edit"
  toolInput: Record<string, unknown>; // 工具的完整输入参数
  description: string; // 人类可读的操作描述
  command?: string; // 当 toolName 含 Bash 时，提取出的 command 字段
}

/** 权限响应：Renderer → Main 回复，用户对权限请求的决定 */
export interface PermissionResponse {
  requestId: string;
  behavior: "allow" | "deny";
  alwaysAllow: boolean; // true = 加入本次会话白名单，后续同类工具自动放行
  userMessage?: string; // 用户在反馈框输入的自由文本（可选）
  // deny 时会拼入 message 传给 Claude，让它据此调整策略
  // allow 时忽略
}

/** AskUserQuestion 单个问题结构 */
export interface AskUserQuestion {
  question: string; // 问题文本
  options?: {
    // 预设选项（可选，没有则纯文本回答）
    label: string;
    description?: string;
  }[];
}

/** AskUserQuestion 请求：Main → Renderer 推送，Agent 主动向用户提问 */
export interface AskUserQuestionRequest {
  requestId: string; // 唯一标识，格式 ask-{timestamp}-{counter}
  questions: AskUserQuestion[]; // 一个或多个问题
  toolInput: Record<string, unknown>; // 标准化后的提问输入，答案由 runtime adapter 合并回工具调用
}

/** AskUserQuestion 回答：Renderer → Main 回复 */
export interface AskUserQuestionAnswer {
  requestId: string;
  answers: Record<string, string>; // key = 问题索引字符串 ("0", "1", ...), value = 用户回答
}

/** HITL 相关的流式事件类型 */
export type HitlEvent =
  | { type: "permission_request"; request: PermissionRequest }
  | { type: "permission_resolved"; requestId: string; behavior: "allow" | "deny" }
  | { type: "ask_user_request"; request: AskUserQuestionRequest }
  | { type: "ask_user_resolved"; requestId: string };

/**
 * SDK 消息与 Anthropic wire payload 的内部透传类型。
 * 顶层事件仍由 AgentStreamEvent 穷举，只有 SDK 自己维护的嵌套 payload 保持宽松，
 * 这样 SDK 增加内部字段不会迫使渲染层复制其完整类型。
 */
export type SdkPassthroughPayload = unknown;

export type AgentWireEvent =
  | { type: "message_start"; message: SdkPassthroughPayload }
  | {
      type: "message_delta";
      delta?: SdkPassthroughPayload;
      stop_reason?: string | null;
      usage?: SdkPassthroughPayload;
    }
  | { type: "message_stop" }
  | {
      type: "content_block_start";
      index: number;
      content_block: SdkPassthroughPayload;
    }
  | {
      type: "content_block_delta";
      index: number;
      delta: SdkPassthroughPayload;
    }
  | { type: "content_block_stop"; index: number };

export type AgentSdkEvent =
  | {
      type: "stream_event";
      event: AgentWireEvent;
      parent_tool_use_id?: string | null;
      uuid?: string;
      session_id?: string;
    }
  | {
      type: "assistant";
      message: SdkPassthroughPayload;
      parent_tool_use_id?: string | null;
      error?: string;
      uuid?: string;
      session_id?: string;
    }
  | {
      type: "user";
      message: SdkPassthroughPayload;
      parent_tool_use_id?: string | null;
      tool_use_result?: SdkPassthroughPayload;
      isReplay?: boolean;
      uuid?: string;
      session_id?: string;
    }
  | {
      type: "system";
      subtype?: string;
      status?: SdkPassthroughPayload;
      compact_metadata?: SdkPassthroughPayload;
      uuid?: string;
      session_id?: string;
    }
  | {
      type: "result";
      subtype?: string;
      usage?: SdkPassthroughPayload;
      uuid?: string;
      session_id?: string;
    };

export interface SessionSyncEvent {
  type: "session_sync";
  source: "desktop" | "feishu" | "schedule";
  workspaceId: string;
  session: SessionMeta | null;
  messages: ConversationMessage[];
}

export type AgentStreamEvent = (
  | AgentControlEvent
  | HitlEvent
  | AgentSdkEvent
  | SessionSyncEvent
) & {
  sessionId?: string;
};

export interface ZoraApi {
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  logClientEvent: (input: ClientLogEventInput) => Promise<void>;
  updater: {
    getStatus: () => Promise<UpdateStatus>;
    checkForUpdates: () => Promise<UpdateStatus>;
    downloadUpdate: () => Promise<UpdateStatus>;
    installUpdate: () => Promise<void>;
    onStatusChanged: (callback: (status: UpdateStatus) => void) => () => void;
  };
  listProviders: () => Promise<ProviderConfig[]>;
  createProvider: (input: ProviderCreateInput) => Promise<ProviderConfig>;
  updateProvider: (id: string, input: ProviderUpdateInput) => Promise<ProviderConfig>;
  deleteProvider: (id: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<void>;
  getProviderApiKey: (providerId: string) => Promise<string | null>;
  testProvider: (
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    testRunId?: string,
    protocol?: ProviderProtocol
  ) => Promise<ProviderTestResult>;
  testProviderWithRoleModels: (
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    roleModels?: RoleModels,
    testRunId?: string,
    protocol?: ProviderProtocol
  ) => Promise<ProviderTestResultWithRoles>;
  cancelProviderTest: (testRunId: string) => Promise<boolean>;
  testDefaultProvider: () => Promise<ProviderTestResult>;
  hasConfiguredProvider: () => Promise<boolean>;
  feishu: {
    getConfig: () => Promise<FeishuConfig | null>;
    saveConfig: (config: FeishuConfig) => Promise<FeishuConfig>;
    testConnection: (params: {
      appId: string;
      appSecret: string;
    }) => Promise<FeishuConnectionTestResult>;
    startBridge: (config?: FeishuConfig) => Promise<FeishuConfig>;
    stopBridge: () => Promise<void>;
    getStatus: () => Promise<FeishuBridgeStatus>;
    onStatusChanged: (callback: (status: FeishuBridgeStatus) => void) => () => void;
    onAgentStateChanged: (
      callback: (payload: { sessionId: string; running: boolean }) => void
    ) => () => void;
  };
  memory: {
    getSettings: () => Promise<MemorySettings>;
    updateSettings: (settings: Partial<MemorySettings>) => Promise<MemorySettings>;
    processNow: () => Promise<{ total: number; processed: number }>;
    getPendingCount: () => Promise<number>;
    onPendingChanged: (callback: (count: number) => void) => () => void;
    getStatus: () => Promise<{ pending: number; processing: number }>;
  };
  defaultModel: {
    getSettings: () => Promise<DefaultModelSettings>;
    updateSettings: (
      settings: Partial<DefaultModelSettings>
    ) => Promise<DefaultModelSettings>;
  };
  vision: {
    getSettings: () => Promise<VisionSettings>;
    getCapabilities: () => Promise<ConfiguredModelCapability[]>;
    updateSettings: (settings: VisionSettings) => Promise<VisionSettings>;
  };
  mcp: {
    getConfig: () => Promise<McpConfig>;
    getEditableConfig: () => Promise<McpConfig>;
    save: (input: McpSaveInput) => Promise<McpSaveResult>;
    deleteServer: (name: string) => Promise<McpConfig>;
    toggleServer: (name: string, enabled: boolean) => Promise<McpConfig>;
    testServer: (name: string, entry: McpServerEntry) => Promise<McpServerTestResult>;
  };
  chat: (
    text: string,
    sessionId: string,
    workspaceId?: string,
    attachments?: FileAttachment[]
  ) => Promise<void>;
  /** 在 Agent 运行期间追加用户消息 */
  queueMessage: (
    sessionId: string,
    text: string,
    workspaceId?: string,
    uuid?: string,
    attachments?: FileAttachment[]
  ) => Promise<string>;
  isAgentRunning: (sessionId: string) => Promise<boolean>;
  getAgentRunInfo: (sessionId: string) => Promise<AgentRunInfo>;
  listSkills: () => Promise<SkillMeta[]>;
  openSkillsDir: () => Promise<void>;
  openSkillDir: (dirName: string) => Promise<void>;
  discoverSkills: () => Promise<DiscoveryResult>;
  importSkill: (
    sourcePath: string,
    method: ImportMethod,
    sourceTool: string,
    dirName?: string
  ) => Promise<ImportResult>;
  importSkills: (selections: ImportSelection[]) => Promise<ImportResult[]>;
  uninstallSkill: (dirName: string) => Promise<void>;
  listExternalTools: () => Promise<ExternalToolConfig[]>;
  listSessions: (workspaceId?: string) => Promise<SessionMeta[]>;
  listArchivedSessions: () => Promise<ArchivedSessionEntry[]>;
  loadMessages: (sessionId: string, workspaceId?: string) => Promise<ConversationMessage[]>;
  getSessionFilePath: (sessionId: string, workspaceId?: string) => Promise<string>;
  createSession: (title: string, workspaceId?: string) => Promise<SessionMeta>;
  forkSession: (input: ForkSessionInput) => Promise<SessionForkResult>;
  archiveSession: (sessionId: string, workspaceId?: string) => Promise<SessionMeta | null>;
  restoreSession: (sessionId: string, workspaceId?: string) => Promise<SessionMeta | null>;
  deleteSession: (sessionId: string, workspaceId?: string) => Promise<void>;
  renameSession: (sessionId: string, title: string, workspaceId?: string) => Promise<void>;
  lockSessionModel: (
    sessionId: string,
    providerId: string,
    modelId: string,
    workspaceId?: string,
    logContext?: SessionModelLogContext
  ) => Promise<{ success: boolean }>;
  switchSessionModel: (
    sessionId: string,
    modelId: string,
    workspaceId?: string,
    logContext?: SessionModelLogContext
  ) => Promise<{ success: boolean }>;
  setSessionRuntime: (
    sessionId: string,
    agentRuntimeType: AgentRuntimeType,
    workspaceId?: string
  ) => Promise<void>;
  setSessionReasoningLevel: (
    sessionId: string,
    reasoningLevel: ReasoningLevel,
    workspaceId?: string
  ) => Promise<void>;
  listWorkspaces: () => Promise<WorkspaceMeta[]>;
  createWorkspace: (name: string, workspacePath: string) => Promise<WorkspaceMeta>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<WorkspaceMeta>;
  pickWorkspaceDirectory: () => Promise<string | null>;
  listScheduledTasks: (workspaceId?: string) => Promise<ScheduledTask[]>;
  getScheduledTask: (
    taskId: string,
    workspaceId: string
  ) => Promise<ScheduledTask | null>;
  updateScheduledTask: (
    input: ScheduledTaskUpdateInput
  ) => Promise<ScheduledTask>;
  deleteScheduledTask: (taskId: string, workspaceId: string) => Promise<void>;
  onScheduledTasksChanged: (
    callback: (workspaceId: string) => void
  ) => () => void;
  filetree: {
    list: (dirPath: string, workspacePath: string) => Promise<FileTreeEntry[]>;
    openInFinder: (dirPath: string) => Promise<void>;
    watch: (workspacePath: string) => Promise<void>;
    unwatch: () => Promise<void>;
    onChanged: (callback: () => void) => () => void;
  };
  onStream: (callback: (event: AgentStreamEvent) => void) => () => void;
  stopAgent: (sessionId: string) => Promise<void>;
  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  selectFiles: () => Promise<FileAttachment[]>;
  readFileAsAttachment: (filePath: string) => Promise<FileAttachment | null>;
  getPathForFile: (file: File) => string;
  /** 回复权限审批请求 */
  respondPermission: (response: PermissionResponse) => Promise<void>;
  /** 回复 Agent 向用户的提问 */
  answerAskUserQuestion: (response: AskUserQuestionAnswer) => Promise<void>;
}

declare global {
  interface Window {
    zora: ZoraApi;
  }
}

export {};
