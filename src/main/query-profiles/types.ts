import type {
  McpServerConfig,
  SdkPluginConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamEvent } from "../../shared/zora";
import type { SDKRuntimeOptions } from "../sdk-runtime";

export type AgentEventForwarder = (event: AgentStreamEvent) => void;
export type QueryProfileName = "awakening" | "productivity" | "memory";

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
  sdkRuntime: SDKRuntimeOptions;
  onEvent: AgentEventForwarder;
  isFirstTurn: boolean;
  sessionId?: string;
  providerId?: string;
  selectedModelId?: string;
}
