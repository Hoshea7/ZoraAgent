import type { ProviderProtocol, AgentRuntimeType } from "./types/provider";

export const RUNTIME_PRODUCT_CAPABILITIES = [
  "toolAuthorization",
  "askUserQuestion",
  "runBudget",
  "builtinMcpTools",
  "skills",
  "externalMcpServers",
  "subAgents",
  "planMode",
  "durableEngineSession",
] as const;

export type RuntimeProductCapability =
  (typeof RUNTIME_PRODUCT_CAPABILITIES)[number];

export interface RuntimeCapabilities {
  readonly protocols: readonly ProviderProtocol[];
  readonly toolAuthorization: boolean;
  readonly askUserQuestion: boolean;
  readonly runBudget: boolean;
  readonly builtinMcpTools: boolean;
  readonly skills: boolean;
  readonly externalMcpServers: boolean;
  readonly subAgents: boolean;
  readonly planMode: boolean;
  readonly durableEngineSession: boolean;
}

export const RUNTIME_CAPABILITIES = {
  claude: {
    protocols: ["anthropic-messages"],
    toolAuthorization: true,
    askUserQuestion: true,
    runBudget: true,
    builtinMcpTools: true,
    skills: true,
    externalMcpServers: true,
    subAgents: true,
    planMode: true,
    durableEngineSession: true,
  },
  pi: {
    protocols: ["anthropic-messages", "openai-completions"],
    toolAuthorization: true,
    askUserQuestion: true,
    runBudget: true,
    builtinMcpTools: true,
    skills: true,
    externalMcpServers: false,
    subAgents: false,
    planMode: false,
    durableEngineSession: false,
  },
} as const satisfies Record<AgentRuntimeType, RuntimeCapabilities>;

export function getRuntimeCapabilities(
  agentRuntimeType: AgentRuntimeType
): RuntimeCapabilities {
  return RUNTIME_CAPABILITIES[agentRuntimeType];
}

export function agentRuntimeSupportsProtocol(
  agentRuntimeType: AgentRuntimeType,
  protocol: ProviderProtocol
): boolean {
  return getRuntimeCapabilities(agentRuntimeType).protocols.includes(protocol);
}

export function getCompatibleAgentRuntimes(protocol: ProviderProtocol): AgentRuntimeType[] {
  return (Object.keys(RUNTIME_CAPABILITIES) as AgentRuntimeType[]).filter((agentRuntimeType) =>
    agentRuntimeSupportsProtocol(agentRuntimeType, protocol)
  );
}
