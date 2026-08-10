import type { Model } from "@earendil-works/pi-ai";
import type { ProviderModelTarget } from "../../shared/types/vision";
import type { ProviderProtocol } from "../../shared/types/provider";
import type { NormalizedImage } from "./image-normalizer";
import type {
  VisionProviderAdapter,
  VisionUsage,
} from "./vision-relay";

type PiStream = typeof import("@earendil-works/pi-ai/compat")["stream"];

interface PiVisionProviderAdapterOptions {
  stream?: PiStream;
  firstResponseTimeoutMs?: number;
}

export class PiVisionProviderAdapter implements VisionProviderAdapter {
  private readonly stream?: PiStream;
  private readonly firstResponseTimeoutMs: number;

  constructor(options: PiVisionProviderAdapterOptions = {}) {
    this.stream = options.stream;
    this.firstResponseTimeoutMs = options.firstResponseTimeoutMs ?? 30_000;
  }

  async generate(input: {
    target: ProviderModelTarget;
    image: NormalizedImage;
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
    signal: AbortSignal;
  }): Promise<{ text: string; usage?: VisionUsage }> {
    const stream = this.stream ?? (await import("@earendil-works/pi-ai/compat")).stream;
    const model: Model<ProviderProtocol> = {
      id: input.target.modelId,
      name: input.target.modelId,
      api: input.target.protocol,
      provider: input.target.providerId,
      baseUrl: input.target.baseUrl,
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: input.maxOutputTokens,
    };
    const timeoutController = new AbortController();
    let firstResponseTimedOut = false;
    const timeout = setTimeout(() => {
      firstResponseTimedOut = true;
      timeoutController.abort(new DOMException("First response timeout", "TimeoutError"));
    }, this.firstResponseTimeoutMs);
    const signal = AbortSignal.any([input.signal, timeoutController.signal]);
    let response;
    try {
      const responseStream = stream(
        model,
        {
          systemPrompt: input.systemPrompt,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: input.userPrompt },
              {
                type: "image",
                data: input.image.data,
                mimeType: input.image.mimeType,
              },
            ],
            timestamp: Date.now(),
          }],
        },
        {
          apiKey: input.target.apiKey,
          maxTokens: input.maxOutputTokens,
          signal,
          maxRetries: 0,
          onResponse: () => {
            clearTimeout(timeout);
          },
        }
      );
      response = await responseStream.result();
    } catch (error) {
      if (firstResponseTimedOut) throw new Error("VISION_TIMEOUT");
      if (input.signal.aborted) throw new Error("VISION_CANCELLED");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (response.stopReason === "aborted") {
      if (firstResponseTimedOut) throw new Error("VISION_TIMEOUT");
      if (input.signal.aborted) throw new Error("VISION_CANCELLED");
      throw new Error(response.errorMessage || "Vision provider request aborted");
    }
    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Vision provider request failed");
    }
    return {
      text: response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(""),
      usage: {
        inputTokens: response.usage.input,
        outputTokens: response.usage.output,
      },
    };
  }
}
