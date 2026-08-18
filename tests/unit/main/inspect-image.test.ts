import { describe, expect, it, vi } from "vitest";
import { InspectImageModule } from "@/main/vision/inspect-image";

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  runtime: "pi" as const,
  mainModel: { providerId: "main-provider", modelId: "main-model" },
  runOrigin: "desktop" as const,
  workingDirectory: "/tmp/project",
  vision: {
    imageInputCapability: "unsupported" as const,
    visionRelayEnabled: true,
  },
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
    settings: { resolveRoute: vi.fn(async () => null) },
    relay: { inspect: vi.fn() },
  };
}

describe("InspectImageModule", () => {
  it("rejects a defensive invocation from a supported main model before reading the attachment", async () => {
    const deps = dependencies("supported");
    const module = new InspectImageModule(deps as never);

    const result = await module.execute({
      attachmentId: "7689a7b0-31f3-44c7-88f2-870e6992e024",
      instruction: "Describe",
    }, { ...context, vision: { ...context.vision, imageInputCapability: "supported" } });

    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("VISION_TOOL_UNAVAILABLE"),
    });
    expect(deps.attachments.resolve).not.toHaveBeenCalled();
  });

  it("returns a route error when the configured visual route becomes unavailable", async () => {
    const module = new InspectImageModule(dependencies("unknown") as never);

    const result = await module.execute({
      attachmentId: "7689a7b0-31f3-44c7-88f2-870e6992e024",
      instruction: "Describe",
    }, { ...context, vision: { ...context.vision, imageInputCapability: "unknown" } });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("VISION_ROUTE_UNAVAILABLE"),
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
    expect(deps.attachments.resolve).not.toHaveBeenCalled();
  });
});
