import { expect, it } from "vitest";
import { describeLive } from "./helpers/skip-guard";
import { PiVisionProviderAdapter } from "@/main/vision/pi-vision-provider-adapter";
import type { ProviderModelTarget } from "@shared/types/vision";
import type { ProviderType } from "@shared/types/provider";

describeLive("Vision Provider Adapter", (provider) => {
  const imageModel = process.env.ZORA_E2E_IMAGE_MODEL_ID?.trim();
  const visionTest = imageModel ? it : it.skip;

  visionTest("sends a normalized image through the configured provider protocol", async () => {
    const protocol = provider.providerType === "anthropic"
      ? "anthropic-messages"
      : "openai-completions";
    const target: ProviderModelTarget = {
      providerId: "live-provider",
      providerType: provider.providerType as ProviderType,
      protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelId: imageModel!,
    };
    const result = await new PiVisionProviderAdapter().generate({
      target,
      image: {
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteLength: 68,
      },
      systemPrompt: "Return a one-word description of the image.",
      userPrompt: "Describe the image.",
      maxOutputTokens: 128,
      signal: new AbortController().signal,
    });

    expect(result.text.trim().length).toBeGreaterThan(0);
  });
});
