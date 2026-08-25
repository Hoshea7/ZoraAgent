import { describe, expect, it, vi } from "vitest";
import {
  VisionRelayModule,
  type VisionProviderAdapter,
} from "@/main/vision/vision-relay";
import type { ProviderModelTarget } from "@/shared/types/vision";

const target: ProviderModelTarget = {
  providerId: "provider-1",
  providerType: "anthropic",
  protocol: "anthropic-messages",
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

describe("VisionRelayModule", () => {
  it("validates a strict observation and adds no provider-controlled safety fields", async () => {
    const adapter: VisionProviderAdapter = {
      generate: vi.fn(async () => ({
        text: "```json\n{\"answer\":\"cat\",\"observations\":[\"animal\"],\"limitations\":[]}\n```",
      })),
    };
    const relay = new VisionRelayModule(adapter);

    await expect(relay.inspect({
      sessionId: "session-1",
      image,
      instruction: "Describe the image",
      target,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      observation: { answer: "cat", observations: ["animal"], limitations: [] },
      attempts: 1,
    });
  });

  it("rejects unknown response properties", async () => {
    const generate = vi.fn(async () => ({
        text: JSON.stringify({
          answer: "cat",
          observations: [],
          limitations: [],
          untrustedSource: false,
        }),
      }));
    const relay = new VisionRelayModule({ generate }, { retryDelayMs: 0 });

    await expect(relay.inspect({
      sessionId: "session-1",
      image,
      instruction: "Describe",
      target,
      signal: new AbortController().signal,
    })).rejects.toThrow("VISION_OUTPUT_INVALID");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("retries one invalid provider output", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: "not-json" })
      .mockResolvedValueOnce({
        text: JSON.stringify({ answer: "ok", observations: [], limitations: [] }),
      });
    const relay = new VisionRelayModule({ generate }, { retryDelayMs: 0 });

    const result = await relay.inspect({
      sessionId: "session-1",
      image,
      instruction: "Describe",
      target,
      signal: new AbortController().signal,
    });

    expect(result.attempts).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("retries one transient provider failure", async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { status: 503 }))
      .mockResolvedValueOnce({
        text: JSON.stringify({ answer: "ok", observations: [], limitations: [] }),
      });
    const relay = new VisionRelayModule({ generate }, { retryDelayMs: 0 });

    const result = await relay.inspect({
      sessionId: "session-1",
      image,
      instruction: "Describe",
      target,
      signal: new AbortController().signal,
    });

    expect(result.attempts).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("rejects responses above 64KB before parsing", async () => {
    const relay = new VisionRelayModule({
      generate: async () => ({ text: "x".repeat(65 * 1024) }),
    });

    await expect(relay.inspect({
      sessionId: "session-1",
      image,
      instruction: "Describe",
      target,
      signal: new AbortController().signal,
    })).rejects.toThrow("VISION_OUTPUT_TOO_LARGE");
  });
});
