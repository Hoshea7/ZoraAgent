import { describe, expect, it, vi } from "vitest";
import {
  buildProviderModelsUrl,
  fetchProviderModels,
  parseProviderModelsResponse,
} from "../../../src/main/provider-model-discovery";

describe("provider model discovery", () => {
  it("builds protocol-specific model listing URLs", () => {
    expect(
      buildProviderModelsUrl("https://openrouter.ai/api/v1/", "openai-completions")
    ).toBe("https://openrouter.ai/api/v1/models");
    expect(
      buildProviderModelsUrl("https://api.anthropic.com", "anthropic-messages")
    ).toBe("https://api.anthropic.com/v1/models");
  });

  it("normalizes and deduplicates model rows", () => {
    expect(
      parseProviderModelsResponse({
        data: [
          { id: " model-a ", display_name: "Model A" },
          { id: "model-a", name: "Duplicate" },
          { id: "model-b" },
          { id: " " },
        ],
      })
    ).toEqual([
      { id: "model-a", name: "Model A" },
      { id: "model-b" },
    ]);
  });

  it("uses the correct authentication header and reports HTTP failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response("denied", { status: 401 }));

    await expect(
      fetchProviderModels(
        "https://openrouter.ai/api/v1",
        "secret",
        "openai-completions",
        fetchMock
      )
    ).resolves.toEqual([{ id: "model-a" }]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer secret",
    });

    await expect(
      fetchProviderModels(
        "https://api.anthropic.com",
        "secret",
        "anthropic-messages",
        fetchMock
      )
    ).rejects.toThrow("获取模型失败（HTTP 401）");
  });
});
