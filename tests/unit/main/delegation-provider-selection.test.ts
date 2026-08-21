import { providerManager } from "@/main/provider-manager";
import { resolveDelegationRuntimeTarget } from "@/main/delegation/provider-selection";

describe("delegation Provider selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("directs callers to list targets when providerId is unavailable", async () => {
    vi.spyOn(providerManager, "list").mockResolvedValue([]);

    await expect(
      resolveDelegationRuntimeTarget({
        providerId: "408c7310-bccd-4cab-9dfd-899570f11569",
        selectedModelId: "glm-5.2",
        preferredRuntime: "pi",
      })
    ).rejects.toThrow(
      "Call list_available_models and use its exact providerId; providerName cannot be used as providerId."
    );
  });

  it("rejects a model that is not paired with the selected Provider", async () => {
    vi.spyOn(providerManager, "list").mockResolvedValue([
      {
        id: "408c7310-bccd-4cab-9dfd-899570f11569",
        name: "火山agent",
        providerType: "custom",
        baseUrl: "https://example.com",
        apiKey: "secret",
        models: [{ id: "glm-5.2", enabled: true }],
        protocol: "anthropic-messages",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await expect(
      resolveDelegationRuntimeTarget({
        providerId: "408c7310-bccd-4cab-9dfd-899570f11569",
        selectedModelId: "deepseek-v4-flash",
        preferredRuntime: "pi",
      })
    ).rejects.toThrow(
      "Model deepseek-v4-flash is not available for Provider 火山agent."
    );
  });
});
