import { describe, expect, it, vi } from "vitest";
import { InspectImageModule } from "@/main/vision/inspect-image";

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  runtime: "pi" as const,
  mainModel: { providerId: "main-provider", modelId: "main-model" },
  runOrigin: "desktop" as const,
  signal: new AbortController().signal,
};

function dependencies(capability: "supported" | "unsupported" | "unknown") {
  return {
    attachments: {
      resolve: vi.fn(async () => ({
        record: {
          attachmentId: "7689a7b0-31f3-44c7-88f2-870e6992e024",
          storageKey: "da67241a-07e3-44b2-97aa-f725a1a0eb51",
          filename: "photo.png",
          mimeType: "image/png",
          size: 3,
          category: "image" as const,
        },
        filePath: "/private/session/photo",
      })),
    },
    normalizer: {
      normalize: vi.fn(async () => ({
        data: "AQID",
        mimeType: "image/png" as const,
        width: 1,
        height: 1,
        byteLength: 3,
      })),
    },
    settings: {
      load: vi.fn(async () => ({ relay: { enabled: false }, capabilityOverrides: [] })),
      resolveRoute: vi.fn(async () => null),
    },
    capabilityResolver: { resolve: vi.fn(() => capability) },
    relay: { inspect: vi.fn() },
  };
}

describe("InspectImageModule", () => {
  it("returns normalized image content directly to a supported main model", async () => {
    const module = new InspectImageModule(dependencies("supported") as never);

    await expect(module.execute({
      attachmentId: "7689a7b0-31f3-44c7-88f2-870e6992e024",
      instruction: "Describe",
    }, context)).resolves.toEqual({
      content: [
        { type: "text", text: expect.stringContaining('"path":"direct"') },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ],
    });
  });

  it("returns a specific error for an unknown main model without a route", async () => {
    const module = new InspectImageModule(dependencies("unknown") as never);

    const result = await module.execute({
      attachmentId: "7689a7b0-31f3-44c7-88f2-870e6992e024",
      instruction: "Describe",
    }, context);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("MODEL_IMAGE_CAPABILITY_UNKNOWN"),
    });
  });

  it("denies relay from scheduled runs", async () => {
    const deps = dependencies("unsupported");
    deps.settings.resolveRoute.mockResolvedValue({
      providerId: "vision-provider",
      providerType: "anthropic",
      protocol: "anthropic-messages",
      baseUrl: "https://example.com",
      apiKey: "sk-test",
      modelId: "vision-model",
    });
    const module = new InspectImageModule(deps as never);

    const result = await module.execute({
      attachmentId: "7689a7b0-31f3-44c7-88f2-870e6992e024",
      instruction: "Describe",
    }, { ...context, runOrigin: "schedule" });

    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("VISION_PERMISSION_DENIED"),
    });
    expect(deps.relay.inspect).not.toHaveBeenCalled();
  });
});
