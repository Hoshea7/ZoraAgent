import {
  getCompatibleAgentRuntimes,
  agentRuntimeSupportsProtocol,
} from "@/shared/runtime-capabilities";

describe("runtime protocol capabilities", () => {
  it("allows both runtimes for Anthropic Messages", () => {
    expect(getCompatibleAgentRuntimes("anthropic-messages")).toEqual(["claude", "pi"]);
  });

  it("allows only Pi for OpenAI Completions", () => {
    expect(getCompatibleAgentRuntimes("openai-completions")).toEqual(["pi"]);
    expect(agentRuntimeSupportsProtocol("claude", "openai-completions")).toBe(false);
  });
});
