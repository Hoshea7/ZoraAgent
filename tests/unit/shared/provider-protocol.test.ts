import { resolveProviderProtocol } from "@/shared/provider-protocol";

describe("resolveProviderProtocol", () => {
  it("returns the configured protocol", () => {
    expect(resolveProviderProtocol({ protocol: "openai-completions" })).toBe(
      "openai-completions"
    );
  });
});
