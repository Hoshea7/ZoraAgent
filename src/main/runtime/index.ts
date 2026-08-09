import { ClaudeAgentRuntimeAdapter } from "./claude-adapter";
import { PiAgentRuntimeAdapter } from "./pi-adapter";
import { AgentRuntimeRouter } from "./runtime-router";

export const agentRuntimeRouter = new AgentRuntimeRouter();
agentRuntimeRouter.registerAdapter(new ClaudeAgentRuntimeAdapter());
agentRuntimeRouter.registerAdapter(new PiAgentRuntimeAdapter());
export type { AgentRuntimeRouter } from "./runtime-router";
