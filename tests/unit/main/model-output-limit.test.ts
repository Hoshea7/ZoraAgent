import { resolveProviderModelMaxTokens } from "@/main/runtime/model-output-limit";

const codingProvider = {
  baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
};

const agentProvider = {
  baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
};

describe("Volc Plan model output limits", () => {
  it.each([
    [codingProvider, "glm-5.3", 128_000],
    [agentProvider, "glm-5.3", 128_000],
    [agentProvider, "kimi-k3", 131_072],
    [codingProvider, "doubao-seed-evolving", 256_000],
    [agentProvider, "doubao-seed-2-1-turbo-260628", 256_000],
    [codingProvider, "doubao-seed-2.0-lite", 128_000],
  ])("uses the verified cap for %s / %s", (provider, id, expected) => {
    expect(
      resolveProviderModelMaxTokens(provider, { id, enabled: true })
    ).toBe(expected);
  });

  it("keeps an explicit provider model cap authoritative", () => {
    expect(
      resolveProviderModelMaxTokens(codingProvider, {
        id: "glm-5.3",
        enabled: true,
        maxTokens: 64_000,
      })
    ).toBe(64_000);
  });

  it("does not apply Volc Plan caps to other routes or unknown models", () => {
    expect(
      resolveProviderModelMaxTokens(
        { baseUrl: "https://ark.cn-beijing.volces.com/api/compatible" },
        { id: "glm-5.3", enabled: true }
      )
    ).toBeUndefined();
    expect(
      resolveProviderModelMaxTokens(codingProvider, {
        id: "unknown-model",
        enabled: true,
      })
    ).toBeUndefined();
  });
});
