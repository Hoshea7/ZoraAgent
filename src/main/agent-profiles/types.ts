import type {
  ConversationMessage,
  ReasoningLevel,
} from "../../shared/zora";

export type AgentProfileId = "productivity" | "memory";

export type { ReasoningLevel } from "../../shared/zora";

/**
 * 模型参数意图，由 Harness 声明，Adapter 翻译。
 * contextWindow 等模型固有属性不在此处，留在 Adapter/ProviderConfig 层。
 */
export interface RunLimits {
  maxTurns: number;
  maxOutputTokens: number;
  reasoningLevel: ReasoningLevel;
}

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
    mode: "interactive" | "unattended";
  };
  limits: RunLimits;
  output: {
    incremental: boolean;
    visible: boolean;
  };
}

export function composeHarnessPrompt(
  harness: AgentRequest,
  userPrompt = harness.prompt.user
): string {
  return harness.prompt.dynamicContext.trim()
    ? `${harness.prompt.dynamicContext}\n\n${userPrompt}`
    : userPrompt;
}
