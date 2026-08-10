import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { PiVisionProviderAdapter } from "@/main/vision/pi-vision-provider-adapter";

const target = {
  providerId: "provider-1",
  providerType: "anthropic" as const,
  protocol: "anthropic-messages" as const,
  baseUrl: "https://example.com",
  apiKey: "sk-test",
  modelId: "vision-model",
};

const image = {
  data: "AQID",
  mimeType: "image/png" as const,
  width: 1,
  height: 1,
  byteLength: 3,
};

function successfulMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "vision result" }],
    api: "anthropic-messages",
    provider: "provider-1",
    model: "vision-model",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function request(adapter: PiVisionProviderAdapter) {
  return adapter.generate({
    target,
    image,
    systemPrompt: "system",
    userPrompt: "describe",
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  });
}

describe("PiVisionProviderAdapter", () => {
  it("allows generation to finish after the first-response deadline once HTTP responded", async () => {
    vi.useFakeTimers();
    try {
      const stream = vi.fn((_model, _context, options) => {
        void options?.onResponse?.({ status: 200, headers: {} }, _model);
        return {
          result: () => new Promise<AssistantMessage>((resolve) => {
            setTimeout(() => resolve(successfulMessage()), 60);
          }),
        };
      });
      const adapter = new PiVisionProviderAdapter({
        stream: stream as never,
        firstResponseTimeoutMs: 30,
      });

      const result = request(adapter);
      await vi.advanceTimersByTimeAsync(60);

      await expect(result).resolves.toMatchObject({ text: "vision result" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns VISION_TIMEOUT when no HTTP response arrives before the deadline", async () => {
    vi.useFakeTimers();
    try {
      const stream = vi.fn((_model, _context, options) => ({
        result: () => new Promise<AssistantMessage>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        }),
      }));
      const adapter = new PiVisionProviderAdapter({
        stream: stream as never,
        firstResponseTimeoutMs: 30,
      });

      const result = request(adapter);
      const rejection = expect(result).rejects.toThrow("VISION_TIMEOUT");
      await vi.advanceTimersByTimeAsync(31);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
