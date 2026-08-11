import type {
  ConversationMessage,
  ReasoningLevel,
} from "../../shared/zora";

export type AgentProfileId = "productivity" | "memory";

export type { ReasoningLevel } from "../../shared/zora";

/** 模型推理意图，由 Adapter 翻译成各引擎参数。 */
export interface ModelTuning {
  maxOutputTokens: number;
  reasoningLevel: ReasoningLevel;
}

/** 运行治理上限，由 L2 Guard 统一执行，与引擎无关。 */
export interface RunBudget {
  maxTurns: number;
}

/**
 * 授权意图（产品层词汇）。
 *
 * 只声明“要不要人参与”，不提引擎参数；各 Adapter 自行翻译
 * （如 Claude SDK 的 default / bypassPermissions）。
 */
export type AgentPermissionIntent = "interactive" | "unattended";

export interface AgentRequest {
  profileId: AgentProfileId;
  sessionId: string;
  workspaceId: string;
  prompt: {
    user: string;
    dynamicContext: string;
    system: string;
  };
  conversation: {
    messages: ConversationMessage[];
    persistence: "durable" | "ephemeral";
  };
  workspace: {
    cwd: string;
  };
  permissions: {
    mode: AgentPermissionIntent;
  };
  model: ModelTuning;
  budget: RunBudget;
  output: {
    incremental: boolean;
    visible: boolean;
  };
}

export function composeHarnessPrompt(
  harness: AgentRequest,
  userPrompt = harness.prompt.user
): string {
  return userPrompt;
}

export function appendDynamicSystemContext(
  systemPrompt: string,
  dynamicContext: string
): string {
  const context = dynamicContext.trim();
  if (!context) return systemPrompt;
  return `${systemPrompt.trimEnd()}\n\n${context}`;
}
