import type { AgentRuntimeType } from "./provider";
import type { ModelIdentity, RunOrigin, VisionRunContext } from "./vision";

export interface ProductToolRunContext {
  workspaceId: string;
  sessionId: string;
  runtime: AgentRuntimeType;
  runOrigin: RunOrigin;
  workingDirectory: string;
  mainModel: ModelIdentity;
  vision: VisionRunContext;
}

export interface ProductToolCallContext extends ProductToolRunContext {
  signal: AbortSignal;
  agentId?: string;
}
