import type { Model } from "@earendil-works/pi-ai";
import type { ProviderModelTarget } from "../../shared/types/vision";
import type { ProviderProtocol } from "../../shared/types/provider";
import type { NormalizedImage } from "./image-normalizer";
import type {
  VisionProviderAdapter,
  VisionUsage,
} from "./vision-relay";

export class PiVisionProviderAdapter implements VisionProviderAdapter {
  async generate(input: {
    target: ProviderModelTarget;
    image: NormalizedImage;
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
    signal: AbortSignal;
  }): Promise<{ text: string; usage?: VisionUsage }> {
    const { complete } = await import("@earendil-works/pi-ai/compat");
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
    const response = await complete(
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
        signal: input.signal,
        timeoutMs: 30_000,
        maxRetries: 0,
      }
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") {
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
