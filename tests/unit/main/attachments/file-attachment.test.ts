import { buildFileAttachment } from "@/main/attachments/file-attachment";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("local attachment selection", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "zora-selection-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it("accepts ZIP files without trying to parse their contents", async () => {
    const file = path.join(directory, "backup.zip");
    await writeFile(file, "zip fixture");
    expect(await buildFileAttachment(file)).toMatchObject({ category: "file", mimeType: "application/zip", localPath: file });
    expect((await buildFileAttachment(file))?.storageMode).toBeUndefined();
  });
  it("references oversized files without parsing or thumbnailing them", async () => {
    const file = path.join(directory, "large.png");
    const handle = await open(file, "w");
    await handle.truncate(101 * 1024 * 1024);
    await handle.close();
    expect(await buildFileAttachment(file)).toMatchObject({ category: "file", storageMode: "reference", localPath: file });
  });
  it("rejects directories and unreadable paths", async () => {
    expect(await buildFileAttachment(directory)).toBeNull();
    expect(await buildFileAttachment(path.join(directory, "missing"))).toBeNull();
  });
});
