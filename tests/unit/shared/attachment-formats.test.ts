import { getAttachmentFormat } from "@/shared/attachment-formats";
import { createMigrationPrompts } from "@/shared/migration-prompts";

describe("attachment formats", () => {
  it.each([
    ["备份.ZIP", "file", "application/zip"],
    ["archive.tar.gz", "file", "application/octet-stream"],
    ["LICENSE", "file", "application/octet-stream"],
    ["photo.PNG", "image", "image/png"],
    ["report.pdf", "document", "application/pdf"],
    ["notes.md", "text", "text/markdown"],
  ])("classifies %s", (filename, category, mimeType) => {
    expect(getAttachmentFormat(filename)).toEqual({ category, mimeType });
  });
});

describe("migration user prompts", () => {
  it.each(["/Users/new/.zora", "C:\\Users\\新用户\\.zora"])("uses the actual directory %s for both tasks", (directory) => {
    const prompts = createMigrationPrompts(directory);
    expect(prompts.archive).toContain(JSON.stringify(directory));
    expect(prompts.restore).toContain(JSON.stringify(directory));
    expect(prompts.archive).toContain("打包到数据目录之外");
    expect(prompts.restore).toContain("覆盖前与我确认");
    expect(prompts.restore).toContain("先在数据目录之外准备恢复内容");
    expect(prompts.restore).toContain("由 Zora 启动升级");
  });
});
