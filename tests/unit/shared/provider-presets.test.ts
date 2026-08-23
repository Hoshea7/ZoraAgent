import {
  PROVIDER_PRESETS,
  getDefaultProviderPreset,
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
});
