import type { ProviderProtocol, RuntimeType } from "./types/provider";

const RUNTIME_PROTOCOLS: Record<RuntimeType, readonly ProviderProtocol[]> = {
  claude: ["anthropic-messages"],
  pi: ["anthropic-messages", "openai-completions"],
};

export function runtimeSupportsProtocol(
  runtimeType: RuntimeType,
  protocol: ProviderProtocol
): boolean {
  return RUNTIME_PROTOCOLS[runtimeType].includes(protocol);
}

export function getCompatibleRuntimes(protocol: ProviderProtocol): RuntimeType[] {
  return (Object.keys(RUNTIME_PROTOCOLS) as RuntimeType[]).filter((runtimeType) =>
    runtimeSupportsProtocol(runtimeType, protocol)
  );
}
