import { resolveSdkEnvForProfile } from "@/main/query-profiles/sdk-env";
import type { AgentRuntimeTarget } from "@/main/runtime/runtime-execution-target";

describe("Claude runtime execution target", () => {
  it("builds the Claude SDK environment from the resolved target", async () => {
    const target: AgentRuntimeTarget = {
      agentRuntimeType: "claude",
      protocol: "openai-completions",
      modelId: "glm-5.2",
      provider: {
        id: "provider-1",
        name: "Provider",
        providerType: "custom",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-live",
      },
    };

    const env = await resolveSdkEnvForProfile("productivity", {
      executionTarget: target,
    });

    expect(env.ANTHROPIC_API_KEY).toBe("sk-live");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://example.com/v1");
    expect(env.ANTHROPIC_MODEL).toBe("glm-5.2");
  });
});
