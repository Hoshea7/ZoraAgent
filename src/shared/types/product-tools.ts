import type { AgentRuntimeType } from "./provider";
import type { ModelIdentity, RunOrigin, VisionRunContext } from "./vision";

export interface ProductToolRunContext {
  workspaceId: string;
  sessionId: string;
  runtime: AgentRuntimeType;
  runOrigin: RunOrigin;
  workingDirectory: string;
  /** Original session binding; empty when an old session has no binding. */
  boundWorkingDirectory?: string;
  mainModel: ModelIdentity;
  vision: VisionRunContext;
}

export interface ProductToolCallContext extends ProductToolRunContext {
  signal: AbortSignal;
  agentId?: string;
}
