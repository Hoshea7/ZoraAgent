import { describe, expect, it, vi } from "vitest";
import {
  fetchProviderModels,
} from "../../../src/main/provider-model-discovery";
import type { ProviderModelDiscoveryInput } from "../../../src/shared/types/provider";

function input(
  overrides: Partial<ProviderModelDiscoveryInput> = {}
): ProviderModelDiscoveryInput {
  return {
    presetId: "openai",
    providerType: "openai",
    protocol: "openai-completions",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "secret",
    ...overrides,
  };
}

describe("provider model discovery", () => {
  it("uses Provider-specific model endpoints and authentication", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      requests.push({ url: String(request), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await fetchProviderModels(
      input({
        presetId: "deepseek",
        providerType: "deepseek",
        protocol: "anthropic-messages",
        baseUrl: "https://api.deepseek.com/anthropic",
      }),
      fetchMock
    );
    await fetchProviderModels(
      input({
        presetId: "moonshot",
        providerType: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1/chat/completions",
      }),
      fetchMock
    );
    await fetchProviderModels(
      input({
        presetId: "volcengine-compatible",
        providerType: "volcengine",
        protocol: "anthropic-messages",
        baseUrl: "https://ark.cn-beijing.volces.com/api/compatible",
      }),
      fetchMock
    );
    await fetchProviderModels(
      input({
        presetId: "custom",
        providerType: "custom",
        protocol: "anthropic-messages",
        baseUrl: "https://api.deepseek.com/anthropic",
      }),
      fetchMock
    );

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.deepseek.com/models",
      "https://api.moonshot.cn/v1/models",
      "https://ark.cn-beijing.volces.com/api/compatible/v1/models",
      "https://api.deepseek.com/models",
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(requests[2]?.headers.get("x-api-key")).toBe("secret");
    expect(requests[2]?.headers.get("authorization")).toBe("Bearer secret");
    expect(requests[2]?.headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("returns the maintained Coding Plan model catalog without a network request", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const models = await fetchProviderModels(
      input({
        presetId: "volcengine-coding-plan",
        providerType: "volcengine",
        protocol: "anthropic-messages",
        baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
      }),
      fetchMock
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(models).toEqual(
      expect.arrayContaining([
        { id: "glm-5.3", name: "GLM-5.3" },
        { id: "minimax-m3", name: "MiniMax M3" },
        { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      ])
    );
  });

  it("normalizes, deduplicates and filters unavailable model rows", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: " model-a ", display_name: "Model A" },
            { id: "model-a", name: "Duplicate" },
            { id: "model-b" },
            { id: "model-c", status: "Shutdown" },
            { id: " " },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(fetchProviderModels(input(), fetchMock)).resolves.toEqual([
      { id: "model-a", name: "Model A" },
      { id: "model-b" },
    ]);
  });

  it("reports HTTP failures without exposing the credential", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("denied", { status: 401 }));

    await expect(fetchProviderModels(input(), fetchMock)).rejects.toThrow(
      "获取模型失败（HTTP 401）"
    );
    await expect(fetchProviderModels(input(), fetchMock)).rejects.not.toThrow("secret");
  });
});
