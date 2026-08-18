import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AttachmentResourceModule } from "@/main/attachment-resource";
import { THUMBNAIL_SUFFIX } from "@/main/attachments/image-thumbnail";

async function createPngFixture(): Promise<string> {
  const filePath = path.join(await mkdtemp(path.join(tmpdir(), "zora-png-")), "fixture.png");
  await writeFile(
    filePath,
    await sharp({
      create: { width: 32, height: 16, channels: 3, background: "#3366aa" },
    })
      .png()
      .toBuffer()
  );
  return filePath;
}

describe("AttachmentResourceModule", () => {
  it("generates authoritative IDs, stores a manifest without absolute paths, and writes an image thumbnail", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const source = await createPngFixture();
    const module = new AttachmentResourceModule(path.join(root, "sessions"));

    const [record] = await module.save("workspace-1", "session-1", [
      {
        id: "renderer-id",
        name: "../sample.png",
        category: "image",
        mimeType: "image/png",
        size: 5,
        localPath: source,
      },
    ]);

    expect(record.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.attachmentId).not.toBe("renderer-id");
    expect(record.filename).toBe("sample.png");
    expect(record.storageKey).toMatch(/^[0-9a-f-]{36}$/);
    const manifest = await readFile(
      path.join(root, "sessions", "workspace-1", "session-1", "manifest.json"),
      "utf8"
    );
    expect(manifest).not.toContain(source);
    expect(manifest).not.toContain("base64");
    const filesDirectory = path.join(
      root,
      "sessions",
      "workspace-1",
      "session-1",
      "files"
    );
    const thumbnail = await sharp(
      path.join(filesDirectory, `${record.storageKey}${THUMBNAIL_SUFFIX}`)
    ).metadata();
    expect(thumbnail.format).toBe("jpeg");
    expect(Math.max(thumbnail.width ?? 0, thumbnail.height ?? 0)).toBeLessThanOrEqual(512);
  });

  it("resolves only an attachment registered to the requested session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const module = new AttachmentResourceModule(path.join(root, "sessions"));
    const [record] = await module.save("workspace-1", "session-1", [
      {
        id: "renderer-id",
        name: "sample.txt",
        category: "text",
        mimeType: "text/plain",
        size: 5,
        localPath: "",
        rawBase64: Buffer.from("hello").toString("base64"),
      },
    ]);

    await expect(
      module.resolve("workspace-1", "session-1", record.attachmentId)
    ).resolves.toMatchObject({ record });
    await expect(
      module.resolve("workspace-1", "session-2", record.attachmentId)
    ).rejects.toThrow("ATTACHMENT_NOT_FOUND");

    const resolved = await module.resolve("workspace-1", "session-1", record.attachmentId);
    await expect(
      module.findByPath("workspace-1", "session-1", resolved.filePath)
    ).resolves.toEqual(record);
    await expect(
      module.findByPath("workspace-1", "session-2", resolved.filePath)
    ).resolves.toBeNull();
  });

  it("copies only selected authoritative records when forking", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const module = new AttachmentResourceModule(path.join(root, "sessions"));
    const records = await module.save("workspace-1", "source", [
      {
        id: "one",
        name: "one.txt",
        category: "text",
        mimeType: "text/plain",
        size: 3,
        localPath: "",
        rawBase64: Buffer.from("one").toString("base64"),
      },
      {
        id: "two",
        name: "two.txt",
        category: "text",
        mimeType: "text/plain",
        size: 3,
        localPath: "",
        rawBase64: Buffer.from("two").toString("base64"),
      },
    ]);

    await module.fork("workspace-1", "source", "target", new Set([records[0].attachmentId]));

    await expect(module.list("workspace-1", "target")).resolves.toEqual([records[0]]);
    await expect(
      module.resolve("workspace-1", "target", records[1].attachmentId)
    ).rejects.toThrow("ATTACHMENT_NOT_FOUND");
  });

  it("copies image thumbnails when forking", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const source = await createPngFixture();
    const sessionsRoot = path.join(root, "sessions");
    const module = new AttachmentResourceModule(sessionsRoot);
    const [record] = await module.save("workspace-1", "source", [
      {
        id: "image-1",
        name: "photo.png",
        category: "image",
        mimeType: "image/png",
        size: 5,
        localPath: source,
      },
    ]);

    await module.fork("workspace-1", "source", "target");

    const targetThumb = path.join(
      sessionsRoot,
      "workspace-1",
      "target",
      "files",
      `${record.storageKey}${THUMBNAIL_SUFFIX}`
    );
    await expect(access(targetThumb)).resolves.toBeUndefined();
  });

  it("commits the retained manifest before removing every orphan file including thumbnails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const sessionsRoot = path.join(root, "sessions");
    const module = new AttachmentResourceModule(sessionsRoot);
    const imageSource = await createPngFixture();
    const [imageRecord, textRecord] = await module.save("workspace-1", "session-1", [
      {
        id: "image",
        name: "photo.png",
        category: "image",
        mimeType: "image/png",
        size: 5,
        localPath: imageSource,
      },
      {
        id: "two",
        name: "two.txt",
        category: "text",
        mimeType: "text/plain",
        size: 3,
        localPath: "",
        rawBase64: Buffer.from("two").toString("base64"),
      },
    ]);
    const filesDirectory = path.join(
      sessionsRoot,
      "workspace-1",
      "session-1",
      "files"
    );
    const previousOrphan = "00000000-0000-4000-8000-000000000000";
    await writeFile(path.join(filesDirectory, previousOrphan), "orphan", "utf8");
    await writeFile(
      path.join(filesDirectory, `${previousOrphan}${THUMBNAIL_SUFFIX}`),
      "orphan-thumb",
      "utf8"
    );

    await module.retain(
      "workspace-1",
      "session-1",
      new Set([imageRecord.attachmentId])
    );

    await expect(module.list("workspace-1", "session-1")).resolves.toEqual([
      imageRecord,
    ]);
    await expect(
      access(path.join(filesDirectory, imageRecord.storageKey))
    ).resolves.toBeUndefined();
    await expect(
      access(
        path.join(filesDirectory, `${imageRecord.storageKey}${THUMBNAIL_SUFFIX}`)
      )
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(filesDirectory, textRecord.storageKey))
    ).rejects.toThrow();
    await expect(
      access(path.join(filesDirectory, previousOrphan))
    ).rejects.toThrow();
    await expect(
      access(path.join(filesDirectory, `${previousOrphan}${THUMBNAIL_SUFFIX}`))
    ).rejects.toThrow();
  });

  it("does not delete files when the manifest is invalid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const sessionsRoot = path.join(root, "sessions");
    const module = new AttachmentResourceModule(sessionsRoot);
    const [record] = await module.save("workspace-1", "session-1", [
      {
        id: "one",
        name: "one.txt",
        category: "text",
        mimeType: "text/plain",
        size: 3,
        localPath: "",
        rawBase64: Buffer.from("one").toString("base64"),
      },
    ]);
    const sessionDirectory = path.join(
      sessionsRoot,
      "workspace-1",
      "session-1"
    );
    await writeFile(path.join(sessionDirectory, "manifest.json"), "invalid", "utf8");

    await expect(
      module.retain("workspace-1", "session-1", new Set())
    ).rejects.toThrow();
    await expect(
      access(path.join(sessionDirectory, "files", record.storageKey))
    ).resolves.toBeUndefined();
  });
});
