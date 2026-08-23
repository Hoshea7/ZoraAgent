import type { ProviderConfig, ProviderProtocol } from "./types/provider";

export function resolveProviderProtocol(
  provider: Pick<ProviderConfig, "protocol">
): ProviderProtocol {
  return provider.protocol;
}
