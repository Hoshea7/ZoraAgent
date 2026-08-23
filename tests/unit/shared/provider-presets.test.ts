import {
  PROVIDER_PRESETS,
  getDefaultProviderPreset,
  resolveProviderPreset,
} from "@/shared/provider-presets";

describe("provider presets", () => {
  it("keeps the two Agent Plan protocols as separate product presets", () => {
    expect(PROVIDER_PRESETS["volcengine-agent-plan-anthropic"]).toMatchObject({
      protocol: "anthropic-messages",
      defaultUrl: "https://ark.cn-beijing.volces.com/api/plan",
    });
    expect(PROVIDER_PRESETS["volcengine-agent-plan-openai"]).toMatchObject({
      protocol: "openai-completions",
      defaultUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    });
  });

  it("uses the Anthropic-compatible endpoint as the Volcengine default", () => {
    expect(getDefaultProviderPreset("volcengine")).toMatchObject({
      id: "volcengine-compatible",
      protocol: "anthropic-messages",
    });
  });

  it("infers a known preset for legacy provider records", () => {
    expect(
      resolveProviderPreset({
        providerType: "volcengine",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
        protocol: "openai-completions",
      }).id
    ).toBe("volcengine-agent-plan-openai");
  });

  it("treats a legacy vendor and protocol mismatch as a custom endpoint", () => {
    expect(
      resolveProviderPreset({
        providerType: "zhipu",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        protocol: "anthropic-messages",
      }).id
    ).toBe("custom");
  });
});
