import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFileAttachment } from "@/main/attachments/file-attachment";
import { AttachmentResourceModule } from "@/main/attachment-resource";
import { resolveAttachmentContent } from "@/main/attachment-handler";

describe("local file attachment lifecycle", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "zora-file-lifecycle-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("copies small archives and projects their saved paths without interpreting ZIP as text", async () => {
    const source = path.join(root, "备份.zip");
    await writeFile(source, Buffer.from([0x50, 0x4b, 3, 4]));
    const input = (await buildFileAttachment(source))!;
    const module = new AttachmentResourceModule(path.join(root, "sessions"));
    const [record] = await module.save("workspace", "session", [input]);
    await rm(source);
    const resolved = await module.resolve("workspace", "session", record.attachmentId);
    expect(await readFile(resolved.filePath)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]));
    const blocks = await resolveAttachmentContent([{ ...input, localPath: resolved.filePath }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain(resolved.filePath);
    expect(blocks[0].text).toContain("文件状态: 可访问");
  });

  it("keeps large file references through reload and fork; session cleanup never deletes the source", async () => {
    const source = path.join(root, "large.zip");
    const handle = await open(source, "w");
    await handle.truncate(101 * 1024 * 1024);
    await handle.close();
    const input = (await buildFileAttachment(source))!;
    const sessions = path.join(root, "sessions");
    const module = new AttachmentResourceModule(sessions);
    const [record] = await module.save("workspace", "session", [input]);
    expect(record.sourcePath).toBe(source);
    expect(await readdir(path.join(sessions, "workspace", "session", "files"))).toEqual([]);
    const reloaded = new AttachmentResourceModule(sessions);
    await reloaded.fork("workspace", "session", "fork");
    expect((await reloaded.resolve("workspace", "fork", record.attachmentId)).filePath).toBe(source);
    await reloaded.retain("workspace", "session", new Set());
    await reloaded.retain("workspace", "fork", new Set());
    expect((await stat(source)).size).toBe(input.size);
    await rm(source);
    const blocks = await resolveAttachmentContent([input]);
    expect(blocks[0].text).toContain("当前无法访问");
  });
});
