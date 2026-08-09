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
  it("normalizes an image supplied as base64", () => {
    expect(resolveAttachmentContent([attachment()])).toEqual([
      {
        type: "image",
        data: "AQID",
        mimeType: "image/png",
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
        { type: "image", data: "AQID", mimeType: "image/png" },
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

  it("reports an unreadable attachment instead of silently dropping it", () => {
    expect(() => resolveAttachmentContent([
      attachment({ base64Data: undefined, localPath: "/missing/image.png" }),
    ])).toThrow("无法读取附件 image.png");
  });
});

describe("buildMultimodalPrompt", () => {
  it("maps normalized product images to Claude content blocks", async () => {
    const messages = [];
    for await (const message of buildMultimodalPrompt("describe", [attachment()])) {
      messages.push(message);
    }

    expect(messages[0]?.message.content).toEqual([
      { type: "text", text: "describe" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "AQID",
        },
      },
    ]);
  });
});
