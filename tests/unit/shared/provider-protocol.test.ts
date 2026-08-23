import { resolveProviderProtocol } from "@/shared/provider-protocol";

describe("resolveProviderProtocol", () => {
  it("keeps providers created before protocol persistence on Anthropic messages", () => {
    expect(resolveProviderProtocol({})).toBe("anthropic-messages");
  });

  it("uses an explicitly persisted protocol", () => {
    expect(
      resolveProviderProtocol({ protocol: "openai-completions" })
    ).toBe("openai-completions");
  });
});
