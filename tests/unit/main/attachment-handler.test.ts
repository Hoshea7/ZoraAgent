import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildMultimodalPrompt,
  resolveAttachmentContent,
} from "@/main/attachment-handler";
import type { FileAttachment } from "@/shared/zora";

function attachment(
  overrides: Partial<FileAttachment> = {}
): FileAttachment {
  return {
    id: "attachment-1",
    name: "image.png",
    category: "image",
    mimeType: "image/png",
    size: 3,
    localPath: "",
    base64Data: "AQID",
    ...overrides,
  };
}

describe("resolveAttachmentContent", () => {
  it("projects images as authoritative attachment references", () => {
    expect(resolveAttachmentContent([attachment()])).toEqual([
      {
        type: "text",
        text: "图片附件：image.png\nattachmentId: attachment-1\n用户传入了图片，你必须要调用 Inspect Image 工具并传入该 attachmentId 查看图片内容。",
      },
    ]);
  });

  it("reads image and text attachments from their saved product paths", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "zora-attachments-"));
    const imagePath = path.join(directory, "image.png");
    const textPath = path.join(directory, "notes.md");
    writeFileSync(imagePath, Buffer.from([1, 2, 3]));
    writeFileSync(textPath, "alpha");

    try {
      expect(resolveAttachmentContent([
        attachment({ base64Data: undefined, localPath: imagePath }),
        attachment({
          id: "attachment-2",
          name: "notes.md",
          category: "text",
          mimeType: "text/markdown",
          localPath: textPath,
          base64Data: undefined,
        }),
      ])).toEqual([
        {
          type: "text",
          text: "图片附件：image.png\nattachmentId: attachment-1\n用户传入了图片，你必须要调用 Inspect Image 工具并传入该 attachmentId 查看图片内容。",
        },
        {
          type: "text",
          text:
            "附件文件：notes.md\n" +
            "文件正文已经包含在下面，请直接使用正文，不要按文件名再次读取。\n\n" +
            "```md\nalpha\n```",
        },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not read image bytes while building the runtime prompt", () => {
    expect(resolveAttachmentContent([
      attachment({ base64Data: undefined, localPath: "/missing/image.png" }),
    ])).toHaveLength(1);
  });
});

describe("buildMultimodalPrompt", () => {
  it("maps image references to Claude text content blocks", async () => {
    const messages = [];
    for await (const message of buildMultimodalPrompt("describe", [attachment()])) {
      messages.push(message);
    }

    expect(messages[0]?.message.content).toEqual([
      { type: "text", text: "describe" },
      {
        type: "text",
        text: "图片附件：image.png\nattachmentId: attachment-1\n用户传入了图片，你必须要调用 Inspect Image 工具并传入该 attachmentId 查看图片内容。",
      },
    ]);
  });
});
