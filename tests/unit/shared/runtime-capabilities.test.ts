import {
  getCompatibleAgentRuntimes,
  agentRuntimeSupportsProtocol,
  getRuntimeCapabilities,
  RUNTIME_PRODUCT_CAPABILITIES,
} from "@/shared/runtime-capabilities";

const ALIGNED_CAPABILITIES = [
  "toolAuthorization",
  "askUserQuestion",
  "runBudget",
  "builtinMcpTools",
  "skills",
] as const;

const CLAUDE_ONLY_CAPABILITIES = [
  "externalMcpServers",
  "subAgents",
  "planMode",
  "durableEngineSession",
] as const;

describe("runtime protocol capabilities", () => {
  it("allows both runtimes for Anthropic Messages", () => {
    expect(getCompatibleAgentRuntimes("anthropic-messages")).toEqual(["claude", "pi"]);
  });

  it("allows only Pi for OpenAI Completions", () => {
    expect(getCompatibleAgentRuntimes("openai-completions")).toEqual(["pi"]);
    expect(agentRuntimeSupportsProtocol("claude", "openai-completions")).toBe(false);
  });
});

describe("runtime product capabilities", () => {
  it("declares the complete product capability set", () => {
    expect(RUNTIME_PRODUCT_CAPABILITIES).toEqual([
      ...ALIGNED_CAPABILITIES,
      ...CLAUDE_ONLY_CAPABILITIES,
    ]);
  });

  it.each(ALIGNED_CAPABILITIES)("supports %s in both runtimes", (capability) => {
    expect(getRuntimeCapabilities("claude")[capability]).toBe(true);
    expect(getRuntimeCapabilities("pi")[capability]).toBe(true);
  });

  it.each(CLAUDE_ONLY_CAPABILITIES)(
    "declares %s as Claude-only",
    (capability) => {
      expect(getRuntimeCapabilities("claude")[capability]).toBe(true);
      expect(getRuntimeCapabilities("pi")[capability]).toBe(false);
    }
  );
});
