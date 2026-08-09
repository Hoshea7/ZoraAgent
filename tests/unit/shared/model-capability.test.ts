import { describe, expect, it } from "vitest";
import {
  ModelCapabilityResolver,
  type ModelCatalogEntry,
} from "@/shared/model-capability";

const catalog: ModelCatalogEntry[] = [
  { providerId: "anthropic", modelId: "catalog-vision", input: ["text", "image"] },
  { providerId: "openai", modelId: "catalog-text", input: ["text"] },
];

describe("ModelCapabilityResolver", () => {
  it("uses an exact user override before catalog and maintained entries", () => {
    const resolver = new ModelCapabilityResolver({
      overrides: [
        { providerId: "provider-1", modelId: "catalog-text", capability: "supported" },
      ],
      catalog,
    });

    expect(
      resolver.resolve(
        { providerId: "provider-1", modelId: "catalog-text" },
        { providerType: "openai" }
      )
    ).toBe("supported");
  });

  it("maps Zora provider types to Pi catalog providers", () => {
    const resolver = new ModelCapabilityResolver({ catalog });

    expect(
      resolver.resolve(
        { providerId: "configured-anthropic", modelId: "catalog-vision" },
        { providerType: "anthropic" }
      )
    ).toBe("supported");
    expect(
      resolver.resolve(
        { providerId: "configured-openai", modelId: "catalog-text" },
        { providerType: "openai" }
      )
    ).toBe("unsupported");
  });

  it("uses only exact model IDs from the maintained capability list", () => {
    const resolver = new ModelCapabilityResolver();

    expect(
      resolver.resolve(
        { providerId: "anthropic-config", modelId: "claude-sonnet-4-20250514" },
        { providerType: "anthropic" }
      )
    ).toBe("supported");
    expect(
      resolver.resolve(
        { providerId: "anthropic-config", modelId: "claude-sonnet-4-20250514-custom" },
        { providerType: "anthropic" }
      )
    ).toBe("unknown");
  });

  it("returns unknown when no exact evidence exists", () => {
    const resolver = new ModelCapabilityResolver({ catalog });

    expect(
      resolver.resolve(
        { providerId: "custom-provider", modelId: "private-model" },
        { providerType: "custom" }
      )
    ).toBe("unknown");
  });

  it("does not classify the text-only o3-mini model as image-capable", () => {
    const resolver = new ModelCapabilityResolver();

    expect(
      resolver.resolve(
        { providerId: "openai-config", modelId: "o3-mini" },
        { providerType: "openai" }
      )
    ).toBe("unknown");
  });

  it("does not apply an override to a different provider with the same model ID", () => {
    const resolver = new ModelCapabilityResolver({
      overrides: [
        { providerId: "provider-1", modelId: "shared-model", capability: "supported" },
      ],
    });

    expect(
      resolver.resolve(
        { providerId: "provider-2", modelId: "shared-model" },
        { providerType: "custom" }
      )
    ).toBe("unknown");
  });
});
