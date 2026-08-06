import {
  getCompatibleRuntimes,
  runtimeSupportsProtocol,
} from "@/shared/runtime-capabilities";

describe("runtime protocol capabilities", () => {
  it("allows both runtimes for Anthropic Messages", () => {
    expect(getCompatibleRuntimes("anthropic-messages")).toEqual(["claude", "pi"]);
  });

  it("allows only Pi for OpenAI Completions", () => {
    expect(getCompatibleRuntimes("openai-completions")).toEqual(["pi"]);
    expect(runtimeSupportsProtocol("claude", "openai-completions")).toBe(false);
  });
});
