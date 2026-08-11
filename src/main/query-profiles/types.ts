import type { AgentStreamEvent } from "../../shared/zora";
import type { SDKRuntimeOptions } from "../sdk-runtime";
import type { AgentRuntimeTarget } from "../runtime/runtime-execution-target";
import type { ToolGate } from "../runtime/tool-gate";
import type { ReasoningLevel } from "../../shared/zora";
import type { ToolProvisioningPlan } from "../runtime/tool-provisioning";
import type { ToolRunContext } from "../../shared/types/vision";

export type AgentEventForwarder = (event: AgentStreamEvent) => void;
export type QueryProfileName = "productivity" | "memory";

export interface QueryProfile {
  name: QueryProfileName;
  prompt: string;
  options: import("@anthropic-ai/claude-agent-sdk").Options;
}

export interface ProfileBuildContext {
  userPrompt: string;
  cwd: string;
  sdkRuntime: SDKRuntimeOptions;
  onEvent: AgentEventForwarder;
  isFirstTurn: boolean;
  sessionId?: string;
  localSessionId?: string;
  executionTarget?: AgentRuntimeTarget;
  toolGate?: ToolGate;
  systemPromptAppend?: string;
  maxTurns?: number;
  reasoningLevel?: ReasoningLevel;
  toolProvisioningPlan: ToolProvisioningPlan;
  toolRunContext?: ToolRunContext;
}
