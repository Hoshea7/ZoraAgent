import { buildPiProvider } from "@/main/runtime/pi-provider-registry";
import type { AgentRuntimeTarget } from "@/main/runtime/runtime-execution-target";
import type { ProviderConfig } from "@/shared/types/provider";

function createProvider(
  overrides: Partial<ProviderConfig> = {}
): ProviderConfig {
  return {
    id: "provider-1",
    name: "OpenAI compatible",
    providerType: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test",
    modelId: "deepseek-chat",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createTarget(
  overrides: Partial<AgentRuntimeTarget> = {}
): AgentRuntimeTarget {
  return {
    agentRuntimeType: "pi",
    provider: createProvider(),
    protocol: "openai-completions",
    modelId: "deepseek-reasoner",
    contextWindow: 200_000,
    ...overrides,
  };
}

describe("buildPiProvider", () => {
  it("builds an OpenAI-compatible Pi provider and honors the selected model", () => {
    expect(buildPiProvider(createTarget())).toEqual({
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      model: "deepseek-reasoner",
      providerId: "provider-1",
      supportsDeveloperRole: false,
      contextWindow: 200_000,
    });
  });

  it("uses an explicit Anthropic protocol override", () => {
    expect(
      buildPiProvider(createTarget({
        provider: createProvider({
          providerType: "custom",
          protocol: "anthropic-messages",
          modelId: "claude-custom",
        }),
        protocol: "anthropic-messages",
        modelId: "claude-custom",
      }))
    ).toEqual({
      api: "anthropic-messages",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      model: "claude-custom",
      providerId: "provider-1",
      supportsDeveloperRole: false,
      contextWindow: 200_000,
    });
  });

  it("uses system messages for Volcengine Agent Plan OpenAI", () => {
    const provider = buildPiProvider(
      createTarget({
        provider: createProvider({
          providerType: "volcengine",
          baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
        }),
      })
    );

    expect(provider.supportsDeveloperRole).toBe(false);
  });

  it("keeps developer messages for the official OpenAI provider", () => {
    const provider = buildPiProvider(
      createTarget({ provider: createProvider({ providerType: "openai" }) })
    );

    expect(provider.supportsDeveloperRole).toBe(true);
  });

  it.each(["api/coding", "api/compatible", "api/plan", "api/plan/v3"])(
    "preserves the configured Volcengine %s endpoint",
    (endpoint) => {
      const provider = buildPiProvider(
        createTarget({
          provider: createProvider({
            providerType: "volcengine",
            baseUrl: `https://ark.cn-beijing.volces.com/${endpoint}`,
          }),
        })
      );

      expect(provider.baseUrl).toBe(
        `https://ark.cn-beijing.volces.com/${endpoint}`
      );
    }
  );
});
