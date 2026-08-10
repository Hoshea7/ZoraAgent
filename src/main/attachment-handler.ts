import { readFileSync } from "node:fs";
import path from "node:path";
import type { FileAttachment } from "../shared/zora";
import type { VisionRunContext } from "../shared/types/vision";

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = TextBlock;

export type ImageAttachmentMode = "read" | "inspect" | "reference" | "neutral";

export interface AttachmentProjectionOptions {
  imageMode: ImageAttachmentMode;
}

export function resolveCurrentAttachmentProjection(
  context: VisionRunContext
): AttachmentProjectionOptions {
  if (!context.visionRelayEnabled) return { imageMode: "reference" };
  return {
    imageMode:
      context.imageInputCapability === "supported" ? "read" : "inspect",
  };
}

export type ResolvedAttachmentContent = TextBlock;

interface MultimodalUserMessage {
  type: "user";
  session_id: string;
  parent_tool_use_id: null;
  message: {
    role: "user";
    content: ContentBlock[];
  };
}

function getCodeFenceLanguage(fileName: string): string {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return extension || "text";
}

function buildTextAttachmentBlock(
  attachment: FileAttachment,
  textContent: string
): TextBlock {
  const language = getCodeFenceLanguage(attachment.name);

  return {
    type: "text",
    text: [
      `附件文件：${attachment.name}`,
      "文件正文已经包含在下面，请直接使用正文，不要按文件名再次读取。",
      "",
      `\`\`\`${language}`,
      textContent,
      "```",
    ].join("\n"),
  };
}

function buildPdfFallbackBlock(attachment: FileAttachment): TextBlock {
  return {
    type: "text",
    text: [
      `用户附带了一个 PDF 文件：${attachment.name}。`,
      "当前这条模型链路不支持 document 类型输入，所以这次无法直接读取 PDF 的正文内容。",
      "如果需要总结 PDF，请切换到支持 document 输入的模型，或在主进程补一层 PDF 文本提取。",
    ].join("\n"),
  };
}

function buildImageReferenceBlock(
  attachment: FileAttachment,
  mode: ImageAttachmentMode
): TextBlock {
  const lines = [
    `图片附件：${attachment.name}`,
    `attachmentId: ${attachment.id}`,
  ];
  if (mode === "read") {
    lines.push(
      `路径: ${attachment.localPath}`,
      "回答前请使用 Read 读取这张图片。每张图片只读取一次，不要根据文件名推断内容。"
    );
  } else if (mode === "inspect") {
    lines.push(
      "回答前请使用 Inspect Image 并传入该 attachmentId 分析这张图片。每张图片只分析一次。"
    );
  } else if (mode === "reference" && attachment.localPath) {
    lines.push(`路径: ${attachment.localPath}`);
  }
  return {
    type: "text",
    text: lines.join("\n"),
  };
}

export function resolveAttachmentContent(
  attachments: FileAttachment[],
  options: AttachmentProjectionOptions = { imageMode: "neutral" }
): ResolvedAttachmentContent[] {
  const content: ResolvedAttachmentContent[] = [];

  for (const attachment of attachments) {
    try {
      switch (attachment.category) {
        case "image": {
          content.push(buildImageReferenceBlock(attachment, options.imageMode));
          break;
        }

        case "document": {
          content.push(buildPdfFallbackBlock(attachment));
          break;
        }

        case "text": {
          if (!attachment.localPath) {
            throw new Error("文本附件没有本地路径");
          }

          content.push(
            buildTextAttachmentBlock(
              attachment,
              readFileSync(attachment.localPath, "utf-8")
            )
          );
          break;
        }
      }
    } catch (error) {
      throw new Error(`无法读取附件 ${attachment.name}`, { cause: error });
    }
  }

  return content;
}

export function attachmentsToContentBlocks(
  attachments: FileAttachment[],
  options: AttachmentProjectionOptions = { imageMode: "neutral" }
): ContentBlock[] {
  return resolveAttachmentContent(attachments, options);
}

export function buildMultimodalPrompt(
  text: string,
  attachments: FileAttachment[],
  options: AttachmentProjectionOptions = { imageMode: "neutral" }
): AsyncIterable<MultimodalUserMessage> {
  const contentBlocks: ContentBlock[] = [];

  if (text) {
    contentBlocks.push({ type: "text", text });
  }

  contentBlocks.push(...attachmentsToContentBlocks(attachments, options));

  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: "text", text: "" });
  }

  async function* promptGenerator(): AsyncIterable<MultimodalUserMessage> {
    yield {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: contentBlocks,
      },
    };
  }

  return promptGenerator();
}
