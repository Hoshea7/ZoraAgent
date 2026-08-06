import type {
  McpServerConfig,
  SdkPluginConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamEvent } from "../../shared/zora";
import type { SDKRuntimeOptions } from "../sdk-runtime";
import type { RuntimeExecutionTarget } from "../runtime/runtime-execution-target";
import type { ReasoningEffort } from "../../shared/zora";

export type AgentEventForwarder = (event: AgentStreamEvent) => void;
export type QueryProfileName = "productivity" | "memory";

/**
 * Claude SDK thinking budget 映射。
 * none -> 不启用 thinking
 * low/medium/high -> 具体 token 预算
 */
export const REASONING_THINKING_BUDGET: Record<ReasoningEffort, number | null> = {
  none: null,
  low: 4_096,
  medium: 10_240,
  high: 32_768,
};

export interface QueryProfile {
  name: QueryProfileName;
  prompt: string;
  options: {
    cwd: string;
    pathToClaudeCodeExecutable: string;
    executable: SDKRuntimeOptions["executable"];
    executableArgs: SDKRuntimeOptions["executableArgs"];
    maxTurns: number;
    persistSession: boolean;
    includePartialMessages: boolean;
    env: Record<string, string>;
    plugins?: SdkPluginConfig[];
    mcpServers?: Record<string, McpServerConfig>;
    strictMcpConfig?: boolean;
    extraArgs?: Record<string, string | null>;
    systemPrompt: {
      type: "preset";
      preset: "claude_code";
      append: string;
    };
    permissionMode: string;
    canUseTool?: (
      toolName: string,
      input: Record<string, unknown>,
      options: unknown
    ) => Promise<unknown>;
    resume?: string;
    maxOutputTokens?: number;
    thinkingBudget?: number;
  };
}

export interface ProfileBuildContext {
  userPrompt: string;
  cwd: string;
  sdkRuntime: SDKRuntimeOptions;
  onEvent: AgentEventForwarder;
  isFirstTurn: boolean;
  sessionId?: string;
  localSessionId?: string;
  executionTarget?: RuntimeExecutionTarget;
  systemPromptAppend?: string;
  maxTurns?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}
