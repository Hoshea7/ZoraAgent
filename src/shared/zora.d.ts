import type {
  FeishuBridgeStatus,
  FeishuConfig,
  FeishuConnectionTestResult,
} from "./types/feishu";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderTestResult,
  ProviderUpdateInput,
} from "./types/provider";
import type {
  DiscoveryResult,
  ExternalToolConfig,
  ImportMethod,
  ImportResult,
  ImportSelection,
} from "./types/skill";

export type AgentStatus = "started" | "finished" | "stopped";
export type AgentRunSource = "desktop" | "feishu" | "awakening" | "memory";
export interface AgentRunInfo {
  running: boolean;
  source?: AgentRunSource;
}
export type PermissionMode = "ask" | "smart" | "yolo";

export interface SkillMeta {
  name: string;
  description: string;
  dirName: string;
  path: string;
}

export interface FileAttachment {
  id: string;
  name: string;
  category: "image" | "document" | "text";
  mimeType: string;
  size: number;
  localPath: string;
  base64Data?: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sdkSessionId?: string;
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

export interface AssistantTurn {
  id: string;
  processSteps: ProcessStep[];
  bodySegments: BodySegment[];
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
    };

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

/** AskUser 单个问题结构 */
export interface AskUserQuestion {
  question: string; // 问题文本
  options?: {
    // 预设选项（可选，没有则纯文本回答）
    label: string;
    description?: string;
  }[];
}

/** AskUser 请求：Main → Renderer 推送，Agent 主动向用户提问 */
export interface AskUserRequest {
  requestId: string; // 唯一标识，格式 ask-{timestamp}-{counter}
  questions: AskUserQuestion[]; // 一个或多个问题
  toolInput: Record<string, unknown>; // 原始工具输入，respond 时会合并 answers 回去
}

/** AskUser 响应：Renderer → Main 回复 */
export interface AskUserResponse {
  requestId: string;
  answers: Record<string, string>; // key = 问题索引字符串 ("0", "1", ...), value = 用户回答
}

/** HITL 相关的流式事件类型 */
export type HitlEvent =
  | { type: "permission_request"; request: PermissionRequest }
  | { type: "permission_resolved"; requestId: string; behavior: "allow" | "deny" }
  | { type: "ask_user_request"; request: AskUserRequest }
  | { type: "ask_user_resolved"; requestId: string };

export type AgentStreamEvent = (
  | AgentControlEvent
  | HitlEvent
  | ({ type: string } & Record<string, unknown>)
) & {
  sessionId?: string;
};

export type AppPhase = "splash" | "awakening-visual" | "awakening-dialogue" | "awakening-complete" | "chat";

export interface ZoraApi {
  getAppVersion: () => Promise<string>;
  listProviders: () => Promise<ProviderConfig[]>;
  createProvider: (input: ProviderCreateInput) => Promise<ProviderConfig>;
  updateProvider: (id: string, input: ProviderUpdateInput) => Promise<ProviderConfig>;
  deleteProvider: (id: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<void>;
  getProviderApiKey: (providerId: string) => Promise<string | null>;
  testProvider: (
    baseUrl: string,
    apiKey: string,
    modelId?: string
  ) => Promise<ProviderTestResult>;
  testDefaultProvider: () => Promise<ProviderTestResult>;
  hasConfiguredProvider: () => Promise<boolean>;
  feishu: {
    getConfig: () => Promise<FeishuConfig | null>;
    saveConfig: (config: FeishuConfig) => Promise<FeishuConfig>;
    testConnection: (params: {
      appId: string;
      appSecret: string;
    }) => Promise<FeishuConnectionTestResult>;
    startBridge: () => Promise<void>;
    stopBridge: () => Promise<void>;
    getStatus: () => Promise<FeishuBridgeStatus>;
    onStatusChanged: (callback: (status: FeishuBridgeStatus) => void) => () => void;
    onAgentStateChanged: (
      callback: (payload: { sessionId: string; running: boolean }) => void
    ) => () => void;
  };
  chat: (
    text: string,
    sessionId: string,
    workspaceId?: string,
    attachments?: FileAttachment[]
  ) => Promise<void>;
  isAgentRunning: (sessionId: string) => Promise<boolean>;
  getAgentRunInfo: (sessionId: string) => Promise<AgentRunInfo>;
  listSkills: () => Promise<SkillMeta[]>;
  onSkillsChanged: (callback: () => void) => () => void;
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
  loadMessages: (sessionId: string, workspaceId?: string) => Promise<ConversationMessage[]>;
  createSession: (title: string, workspaceId?: string) => Promise<SessionMeta>;
  deleteSession: (sessionId: string, workspaceId?: string) => Promise<void>;
  renameSession: (sessionId: string, title: string, workspaceId?: string) => Promise<void>;
  listWorkspaces: () => Promise<WorkspaceMeta[]>;
  createWorkspace: (name: string, workspacePath: string) => Promise<WorkspaceMeta>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  pickWorkspaceDirectory: () => Promise<string | null>;
  onStream: (callback: (event: AgentStreamEvent) => void) => () => void;
  stopAgent: (sessionId: string) => Promise<void>;
  isAwakened: () => Promise<boolean>;
  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  selectFiles: () => Promise<FileAttachment[]>;
  readFileAsAttachment: (filePath: string) => Promise<FileAttachment | null>;
  getPathForFile: (file: File) => string;
  /** 回复权限审批请求 */
  respondPermission: (response: PermissionResponse) => Promise<void>;
  /** 回复 Agent 向用户的提问 */
  respondAskUser: (response: AskUserResponse) => Promise<void>;
  awaken: (text: string) => Promise<void>;
  awakeningComplete: () => Promise<void>;
}

declare global {
  interface Window {
    zora: ZoraApi;
  }
}

export {};
