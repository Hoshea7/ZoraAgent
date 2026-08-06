import type { ProviderConfig, ProviderProtocol } from "./types/provider";

/**
 * Providers saved before protocol selection existed were all executed through
 * the Claude/Anthropic-compatible path. Keep that behavior until the provider
 * is explicitly recreated or its type is changed.
 */
export function resolveProviderProtocol(
  provider: Pick<ProviderConfig, "protocol">
): ProviderProtocol {
  return provider.protocol ?? "anthropic-messages";
}
