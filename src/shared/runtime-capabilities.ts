import type { ProviderProtocol, AgentRuntimeType } from "./types/provider";

/**
 * Runtime 与 Provider 协议的兼容矩阵。
 *
 * 这里只声明**协议**能力，因为它有唯一可信来源：SDK 实际支持哪些 wire protocol
 * 是编译期事实，且被 runtime/runtime-execution-target.ts 在执行前真正用于拦截。
 *
 * 曾经这里还有一张手写的"产品能力表"（externalMcpServers / subAgents / planMode
 * 等 9 个布尔），仅用于在 UI 上罗列引擎差异。它被移除了，原因是它没有可信来源：
 * 表是人手维护的，与实现之间没有任何机制保证一致 —— 实测 `planMode: claude: true`
 * 就是错的（全仓无 plan mode 实现，产品 PermissionMode 只有 ask/smart/yolo）。
 * 一张会失真的能力表比没有表更糟：它让用户以为某能力存在。
 *
 * 若日后要重新引入产品能力声明，必须由实现侧派生（例如各 adapter 自行 report
 * 已装配的能力），而不是在此维护一份平行事实。
 */
export const RUNTIME_CAPABILITIES = {
  claude: {
    protocols: ["anthropic-messages"],
  },
  pi: {
    protocols: ["anthropic-messages", "openai-completions"],
  },
} as const satisfies Record<AgentRuntimeType, RuntimeCapabilities>;

export interface RuntimeCapabilities {
  readonly protocols: readonly ProviderProtocol[];
}

function getRuntimeCapabilities(
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
