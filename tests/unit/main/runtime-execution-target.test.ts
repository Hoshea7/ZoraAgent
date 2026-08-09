import { resolveAgentRuntimeTarget } from "@/main/runtime/runtime-execution-target";
import { AgentRuntimeNotAvailableError } from "@/main/runtime/types";
import type { ProviderConfig } from "@/shared/types/provider";

function createProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider-1",
    name: "OpenAI compatible",
    providerType: "custom",
    baseUrl: "https://example.com/v1",
    apiKey: "encrypted-value",
    modelId: "glm-5.2",
    enabled: true,
    isDefault: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("resolveAgentRuntimeTarget", () => {
  it("keeps legacy providers on the Anthropic protocol when the session has no model override", async () => {
    const target = await resolveAgentRuntimeTarget(
      {
        agentRuntimeType: "pi",
        providerId: "provider-1",
      },
      async () => ({ provider: createProvider(), apiKey: "sk-live" })
    );

    expect(target).toMatchObject({
      agentRuntimeType: "pi",
      modelId: "glm-5.2",
      protocol: "anthropic-messages",
      provider: {
        id: "provider-1",
        apiKey: "sk-live",
      },
    });
  });

  it("uses an explicitly saved OpenAI protocol for new providers", async () => {
    const target = await resolveAgentRuntimeTarget(
      {
        agentRuntimeType: "pi",
        providerId: "provider-1",
      },
      async () => ({
        provider: createProvider({ protocol: "openai-completions" }),
        apiKey: "sk-live",
      })
    );

    expect(target.protocol).toBe("openai-completions");
  });

  it("rejects an OpenAI protocol target for Claude", async () => {
    const error = await resolveAgentRuntimeTarget(
      {
        agentRuntimeType: "claude",
        providerId: "provider-1",
      },
      async () => ({
        provider: createProvider({ protocol: "openai-completions" }),
        apiKey: "sk-live",
      })
    ).catch((caught) => caught);

    expect(error).toMatchObject({
      agentRuntimeType: "claude",
      reason: "protocol_not_supported",
    });
  });

  it("uses the session model override for every runtime", async () => {
    const lookup = async () => ({
      provider: createProvider({
        roleModels: { haikuModel: "glm-5.2-fast" },
      }),
      apiKey: "sk-live",
    });

    const [piTarget, claudeTarget] = await Promise.all([
      resolveAgentRuntimeTarget(
        {
          agentRuntimeType: "pi",
          providerId: "provider-1",
          selectedModelId: "glm-5.2-fast",
        },
        lookup
      ),
      resolveAgentRuntimeTarget(
        {
          agentRuntimeType: "claude",
          providerId: "provider-1",
          selectedModelId: "glm-5.2-fast",
        },
        lookup
      ),
    ]);

    expect(piTarget.modelId).toBe("glm-5.2-fast");
    expect(claudeTarget.modelId).toBe("glm-5.2-fast");
  });

  it("reports the missing configuration field", async () => {
    const error = await resolveAgentRuntimeTarget(
      {
        agentRuntimeType: "pi",
        providerId: "provider-1",
      },
      async () => ({
        provider: createProvider({ modelId: undefined }),
        apiKey: "sk-live",
      })
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(AgentRuntimeNotAvailableError);
    expect(error).toMatchObject({
      agentRuntimeType: "pi",
      reason: "model_missing",
    });
  });

  it("falls back to the provider model when a saved override is no longer configured", async () => {
    const target = await resolveAgentRuntimeTarget(
      {
        agentRuntimeType: "pi",
        providerId: "provider-1",
        selectedModelId: "removed-model",
      },
      async () => ({ provider: createProvider(), apiKey: "sk-live" })
    );

    expect(target.modelId).toBe("glm-5.2");
  });

  it("reports a session without a provider as unavailable", async () => {
    const error = await resolveAgentRuntimeTarget({
      agentRuntimeType: "pi",
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      agentRuntimeType: "pi",
      reason: "provider_not_found",
    });
  });
});
