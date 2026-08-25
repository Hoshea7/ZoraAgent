import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildMultimodalPrompt,
  resolveAttachmentContent,
  resolveCurrentAttachmentProjection,
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
  it("projects supported current images to the native Read tool", async () => {
    expect(await resolveAttachmentContent([attachment({
      localPath: "/sessions/attachments/image-1",
    })], { imageMode: "read" })).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/attachmentId: attachment-1[\s\S]*路径: \/sessions\/attachments\/image-1[\s\S]*使用 Read/),
      },
    ]);
  });

  it("projects unsupported current images to Inspect Image without exposing a path", async () => {
    const result = await resolveAttachmentContent([attachment({
      localPath: "/sessions/attachments/image-1",
    })], { imageMode: "inspect" });

    expect(result[0]?.text).toContain("使用 Inspect Image");
    expect(result[0]?.text).toContain("attachmentId: attachment-1");
    expect(result[0]?.text).not.toContain("/sessions/attachments/image-1");
  });

  it("keeps historical image references neutral and path-free", async () => {
    const result = await resolveAttachmentContent([attachment({
      localPath: "/sessions/attachments/image-1",
    })], { imageMode: "neutral" });

    expect(result[0]?.text).toContain("图片附件：image.png");
    expect(result[0]?.text).not.toContain("/sessions/attachments/image-1");
    expect(result[0]?.text).not.toMatch(/必须|Inspect Image|使用 Read/);
  });

  it("keeps the ordinary attachment path when relay is disabled", async () => {
    const result = await resolveAttachmentContent([attachment({
      localPath: "/sessions/attachments/image-1",
    })], { imageMode: "reference" });

    expect(result[0]?.text).toContain("路径: /sessions/attachments/image-1");
    expect(result[0]?.text).not.toMatch(/必须|Inspect Image|使用 Read/);
  });

  it("reads image and text attachments from their saved product paths", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "zora-attachments-"));
    const imagePath = path.join(directory, "image.png");
    const textPath = path.join(directory, "notes.md");
    writeFileSync(imagePath, Buffer.from([1, 2, 3]));
    writeFileSync(textPath, "alpha");

    try {
      expect(await resolveAttachmentContent([
        attachment({ base64Data: undefined, localPath: imagePath }),
        attachment({
          id: "attachment-2",
          name: "notes.md",
          category: "text",
          mimeType: "text/markdown",
          localPath: textPath,
          base64Data: undefined,
        }),
      ], { imageMode: "neutral" })).toEqual([
        {
          type: "text",
          text: "图片附件：image.png\nattachmentId: attachment-1",
        },
        {
          type: "text",
          text:
            "附件文件：notes.md\n" +
            "attachmentId: attachment-2\n" +
            "文件正文已经包含在下面，请直接使用正文，不要按文件名再次读取。\n\n" +
            "```md\nalpha\n```",
        },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not read image bytes while building the runtime prompt", async () => {
    expect(await resolveAttachmentContent([
      attachment({ base64Data: undefined, localPath: "/missing/image.png" }),
    ], { imageMode: "neutral" })).toHaveLength(1);
  });
});

describe("resolveCurrentAttachmentProjection", () => {
  it("uses Read for an image-capable model without requiring a relay route", () => {
    expect(resolveCurrentAttachmentProjection({
      imageInputCapability: "supported",
      visionRelayEnabled: false,
    })).toEqual({ imageMode: "read" });
  });

  it("uses Inspect Image only when an incapable model has a relay route", () => {
    expect(resolveCurrentAttachmentProjection({
      imageInputCapability: "unsupported",
      visionRelayEnabled: true,
    })).toEqual({ imageMode: "inspect" });
    expect(resolveCurrentAttachmentProjection({
      imageInputCapability: "unsupported",
      visionRelayEnabled: false,
    })).toEqual({ imageMode: "reference" });
  });
});

describe("buildMultimodalPrompt", () => {
  it("maps image references to Claude text content blocks", async () => {
    const messages = [];
    for await (const message of await buildMultimodalPrompt("describe", [attachment({
      localPath: "/sessions/attachments/image-1",
    })], { imageMode: "inspect" })) {
      messages.push(message);
    }

    expect(messages[0]?.message.content).toEqual([
      { type: "text", text: "describe" },
      {
        type: "text",
        text: expect.stringContaining("使用 Inspect Image"),
      },
    ]);
  });
});
