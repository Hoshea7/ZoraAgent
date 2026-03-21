import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamEvent } from "../../shared/zora";

export type AgentEventForwarder = (event: AgentStreamEvent) => void;
export type QueryProfileName = "awakening" | "productivity" | "memory";

export interface QueryProfile {
  name: QueryProfileName;
  prompt: string;
  options: {
    cwd: string;
    pathToClaudeCodeExecutable: string;
    executable: string;
    executableArgs: string[];
    maxTurns: number;
    persistSession: boolean;
    includePartialMessages: boolean;
    env: Record<string, string>;
    plugins?: SdkPluginConfig[];
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
  };
}

export interface ProfileBuildContext {
  userPrompt: string;
  cwd: string;
  sdkCliPath: string;
  onEvent: AgentEventForwarder;
  isFirstTurn: boolean;
  sessionId?: string;
  providerId?: string;
  selectedModelId?: string;
}
