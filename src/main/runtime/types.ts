import type {
  AgentRunSource,
  AgentStreamEvent,
  FileAttachment,
  RuntimeType,
} from "../../shared/zora";
import type { RuntimeExecutionTarget } from "./runtime-execution-target";
import type { AgentHarnessSpec } from "../agent-profiles";
import type { ReasoningEffort } from "../../shared/zora";

export type RuntimePermissionMode = "default" | "bypassPermissions";

export interface RuntimeQueryInput {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  forwardEvent: (event: AgentStreamEvent) => void;
  attachments?: FileAttachment[];
  permissionMode?: RuntimePermissionMode;
  target: RuntimeExecutionTarget;
  workingDirectory?: string;
  source: AgentRunSource;
  reasoningEffort?: ReasoningEffort;
}

export interface RuntimeStartInput {
  harness: AgentHarnessSpec;
  target: RuntimeExecutionTarget;
  attachments?: FileAttachment[];
  source: AgentRunSource;
  forwardEvent: (event: AgentStreamEvent) => void;
}

export interface RuntimeQueuedMessage {
  id: string;
  text: string;
}

export interface RuntimeRunResult {
  status: "completed" | "stopped";
}

export interface RuntimeRunHandle {
  readonly completion: Promise<RuntimeRunResult>;
  abort(): Promise<void>;
  enqueue(message: RuntimeQueuedMessage): Promise<void>;
}

export interface RuntimeAdapter {
  readonly type: RuntimeType;
  start(input: RuntimeStartInput): RuntimeRunHandle;
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

const RUNTIME_UNAVAILABLE_MESSAGES: Record<RuntimeUnavailableReason, string> = {
  provider_not_found: "当前会话绑定的 Provider 不存在，请重新选择 Provider。",
  provider_disabled: "当前会话绑定的 Provider 已停用，请先启用或重新选择 Provider。",
  api_key_missing: "当前 Provider 缺少 API key，请先补全配置。",
  base_url_missing: "当前 Provider 缺少 baseUrl，请先补全配置。",
  model_missing: "当前 Provider 缺少可用模型，请先补全模型配置。",
  protocol_not_supported: "所选 Runtime 不支持当前 Provider 的接口协议。",
  adapter_not_registered: "所选 Runtime 尚未注册。",
  runtime_initialization_failed: "所选 Runtime 初始化失败。",
};

export class RuntimeNotAvailableError extends Error {
  readonly runtimeType: RuntimeType;
  readonly reason: RuntimeUnavailableReason;

  constructor(
    runtimeType: RuntimeType,
    reason: RuntimeUnavailableReason = "adapter_not_registered"
  ) {
    super(RUNTIME_UNAVAILABLE_MESSAGES[reason]);
    this.name = "RuntimeNotAvailableError";
    this.runtimeType = runtimeType;
    this.reason = reason;
  }
}
