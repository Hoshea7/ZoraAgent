import type { AgentStreamEvent } from "../../shared/zora";

export type AgentEventForwarder = (event: AgentStreamEvent) => void;
export type QueryProfileName = "awakening" | "productivity";

export interface QueryProfile {
  name: QueryProfileName;
  prompt: string;
  options: Record<string, unknown>;
}

export interface ProfileBuildContext {
  userPrompt: string;
  cwd: string;
  sdkCliPath: string;
  onEvent: AgentEventForwarder;
  isFirstTurn: boolean;
  sessionId?: string;
}
