import type { ProviderProtocol, AgentRuntimeType } from "./types/provider";

const AGENT_RUNTIME_PROTOCOLS: Record<AgentRuntimeType, readonly ProviderProtocol[]> = {
  claude: ["anthropic-messages"],
  pi: ["anthropic-messages", "openai-completions"],
};

export function agentRuntimeSupportsProtocol(
  agentRuntimeType: AgentRuntimeType,
  protocol: ProviderProtocol
): boolean {
  return AGENT_RUNTIME_PROTOCOLS[agentRuntimeType].includes(protocol);
}

export function getCompatibleAgentRuntimes(protocol: ProviderProtocol): AgentRuntimeType[] {
  return (Object.keys(AGENT_RUNTIME_PROTOCOLS) as AgentRuntimeType[]).filter((agentRuntimeType) =>
    agentRuntimeSupportsProtocol(agentRuntimeType, protocol)
  );
}
