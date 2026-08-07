import type {
  AgentRunSource,
  AgentStreamEvent,
  FileAttachment,
  AgentRuntimeType,
} from "../../shared/zora";
import type { AgentRuntimeTarget } from "./runtime-execution-target";
import type { AgentPermissionIntent, AgentRequest } from "../agent-profiles";
import type { ReasoningLevel } from "../../shared/zora";
import type { ToolGate } from "./tool-gate";

export const DEFAULT_AGENT_RUNTIME: AgentRuntimeType = "pi";

export interface RuntimeQueryInput {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  forwardEvent: (event: AgentStreamEvent) => void;
  attachments?: FileAttachment[];
  permissionMode?: AgentPermissionIntent;
  target: AgentRuntimeTarget;
  workingDirectory?: string;
  source: AgentRunSource;
  reasoningLevel?: ReasoningLevel;
  /** 已有的 Pi SDK session ID，用于恢复引擎 transcript。 */
  sdkSessionId?: string;
  /** Pi SDK session 文件路径，用于恢复。 */
  piSessionFile?: string;
}

export interface AgentRuntimeInput {
  harness: AgentRequest;
  target: AgentRuntimeTarget;
  /** 必填：授权是安全边界，不允许用「缺省」表达放行。 */
  toolGate: ToolGate;
  attachments?: FileAttachment[];
  source: AgentRunSource;
  forwardEvent: (event: AgentStreamEvent) => void;
  /** 已有的 Pi SDK session ID，用于恢复引擎 transcript。 */
  sdkSessionId?: string;
  /** Pi SDK session 文件路径，用于恢复。 */
  piSessionFile?: string;
  /** 引擎首次创建或恢复 session 后回调，产品层持久化 session 标识。 */
  onSessionId?: (sdkSessionId: string, piSessionFile?: string) => void;
}

export interface AgentRuntimeQueuedMessage {
  id: string;
  text: string;
}

export interface AgentRuntimeRunResult {
  status: "completed" | "stopped";
}

export interface AgentRuntimeHandle {
  readonly completion: Promise<AgentRuntimeRunResult>;
  abort(): Promise<void>;
  enqueue(message: AgentRuntimeQueuedMessage): Promise<void>;
}

export interface AgentRuntimeAdapter {
  readonly type: AgentRuntimeType;
  start(input: AgentRuntimeInput): AgentRuntimeHandle;
  dispose(): void;
}

export type RuntimeUnavailableReason =
  | "provider_not_found"
  | "provider_disabled"
  | "api_key_missing"
  | "base_url_missing"
  | "model_missing"
  | "protocol_not_supported"
  | "adapter_not_registered"
  | "runtime_initialization_failed";

const AGENT_RUNTIME_UNAVAILABLE_MESSAGES: Record<RuntimeUnavailableReason, string> = {
  provider_not_found: "当前会话绑定的 Provider 不存在，请重新选择 Provider。",
  provider_disabled: "当前会话绑定的 Provider 已停用，请先启用或重新选择 Provider。",
  api_key_missing: "当前 Provider 缺少 API key，请先补全配置。",
  base_url_missing: "当前 Provider 缺少 baseUrl，请先补全配置。",
  model_missing: "当前 Provider 缺少可用模型，请先补全模型配置。",
  protocol_not_supported: "所选 Runtime 不支持当前 Provider 的接口协议。",
  adapter_not_registered: "所选 Runtime 尚未注册。",
  runtime_initialization_failed: "所选 Runtime 初始化失败。",
};

export class AgentRuntimeNotAvailableError extends Error {
  readonly agentRuntimeType: AgentRuntimeType;
  readonly reason: RuntimeUnavailableReason;

  constructor(
    agentRuntimeType: AgentRuntimeType,
    reason: RuntimeUnavailableReason = "adapter_not_registered"
  ) {
    super(AGENT_RUNTIME_UNAVAILABLE_MESSAGES[reason]);
    this.name = "AgentRuntimeNotAvailableError";
    this.agentRuntimeType = agentRuntimeType;
    this.reason = reason;
  }
}
