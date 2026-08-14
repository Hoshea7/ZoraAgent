import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentResourceModule } from "@/main/attachment-resource";

describe("AttachmentResourceModule", () => {
  it("generates authoritative IDs and stores a manifest without absolute paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const source = path.join(root, "source.png");
    await writeFile(source, Buffer.from("image"));
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
        base64Data: Buffer.from("hello").toString("base64"),
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
        base64Data: Buffer.from("one").toString("base64"),
      },
      {
        id: "two",
        name: "two.txt",
        category: "text",
        mimeType: "text/plain",
        size: 3,
        localPath: "",
        base64Data: Buffer.from("two").toString("base64"),
      },
    ]);

    await module.fork("workspace-1", "source", "target", new Set([records[0].attachmentId]));

    await expect(module.list("workspace-1", "target")).resolves.toEqual([records[0]]);
    await expect(
      module.resolve("workspace-1", "target", records[1].attachmentId)
    ).rejects.toThrow("ATTACHMENT_NOT_FOUND");
  });

  it("commits the retained manifest before removing every orphan file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-attachments-"));
    const sessionsRoot = path.join(root, "sessions");
    const module = new AttachmentResourceModule(sessionsRoot);
    const records = await module.save("workspace-1", "session-1", [
      {
        id: "one",
        name: "one.txt",
        category: "text",
        mimeType: "text/plain",
        size: 3,
        localPath: "",
        base64Data: Buffer.from("one").toString("base64"),
      },
      {
        id: "two",
        name: "two.txt",
        category: "text",
        mimeType: "text/plain",
        size: 3,
        localPath: "",
        base64Data: Buffer.from("two").toString("base64"),
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

    await module.retain(
      "workspace-1",
      "session-1",
      new Set([records[0].attachmentId])
    );

    await expect(module.list("workspace-1", "session-1")).resolves.toEqual([
      records[0],
    ]);
    await expect(
      access(path.join(filesDirectory, records[0].storageKey))
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(filesDirectory, records[1].storageKey))
    ).rejects.toThrow();
    await expect(access(path.join(filesDirectory, previousOrphan))).rejects.toThrow();
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
        base64Data: Buffer.from("one").toString("base64"),
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
