import { normalizeAgentUsage } from "@/shared/agent-usage";

describe("normalizeAgentUsage", () => {
  it("normalizes the common Claude/Pi token fields", () => {
    expect(
      normalizeAgentUsage({
        input_tokens: 120,
        output_tokens: 30,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 5,
      })
    ).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
    });
  });

  it("rejects payloads without token counters", () => {
    expect(normalizeAgentUsage(undefined)).toBeNull();
    expect(normalizeAgentUsage({ duration_ms: 100 })).toBeNull();
  });
});
