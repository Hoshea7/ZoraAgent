import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { AttachmentResourceModule } from "@/main/attachment-resource";
import { ImageNormalizer } from "@/main/vision/image-normalizer";
import { InspectImageModule } from "@/main/vision/inspect-image";

describe("vision attachment flow", () => {
  it("saves a renderer image, resolves it by session ID, normalizes it and returns relay observations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-vision-flow-"));
    const sourcePath = path.join(root, "pasted.png");
    const sourceBytes = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "blue" },
    }).png().toBuffer();
    await writeFile(sourcePath, sourceBytes);
    const attachments = new AttachmentResourceModule(path.join(root, "attachments"));
    const [record] = await attachments.save("workspace-1", "session-1", [{
      id: "renderer-temporary-id",
      name: "pasted.png",
      category: "image",
      mimeType: "image/png",
      size: sourceBytes.byteLength,
      localPath: sourcePath,
    }]);
    const inspect = vi.fn(async () => ({
      observation: {
        answer: "blue image",
        observations: ["blue"],
        limitations: [],
      },
      attempts: 1,
    }));
    const module = new InspectImageModule({
      attachments,
      normalizer: new ImageNormalizer(),
      settings: { resolveRoute: async () => ({
        providerId: "vision-provider",
        providerType: "anthropic",
        protocol: "anthropic-messages",
        baseUrl: "https://example.com",
        apiKey: "sk-test",
        modelId: "vision-model",
      }) },
      relay: { inspect },
    } as never);

    const result = await module.execute({
      attachmentId: record.attachmentId,
      instruction: "Describe",
    }, {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runtime: "claude",
      mainModel: { providerId: "provider-1", modelId: "model-1" },
      runOrigin: "desktop",
      imageInputCapability: "unsupported",
      visionRelayEnabled: true,
      signal: new AbortController().signal,
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("blue image"),
    });
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      image: expect.objectContaining({
        mimeType: expect.stringMatching(/^image\/(png|jpeg)$/),
      }),
    }));
    expect(JSON.stringify(result.content[0])).not.toContain(sourcePath);
  });

  it("rejects an attachment ID from another session before reading bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-vision-flow-"));
    const attachments = new AttachmentResourceModule(path.join(root, "attachments"));
    const [record] = await attachments.save("workspace-1", "session-1", [{
      id: "renderer-id",
      name: "photo.png",
      category: "image",
      mimeType: "image/png",
      size: 3,
      localPath: "",
      base64Data: "AQID",
    }]);
    const module = new InspectImageModule({
      attachments,
      normalizer: { normalize: async () => { throw new Error("must not run"); } },
      settings: { resolveRoute: async () => null },
      relay: { inspect: async () => { throw new Error("must not run"); } },
    } as never);

    const result = await module.execute({
      attachmentId: record.attachmentId,
      instruction: "Describe",
    }, {
      workspaceId: "workspace-1",
      sessionId: "session-2",
      runtime: "pi",
      mainModel: { providerId: "provider-1", modelId: "model-1" },
      runOrigin: "desktop",
      imageInputCapability: "unsupported",
      visionRelayEnabled: true,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("VISION_ATTACHMENT_NOT_FOUND"),
    });
  });
});
