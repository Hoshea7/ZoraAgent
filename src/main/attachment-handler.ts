import { readFileSync } from "node:fs";
import path from "node:path";
import type { FileAttachment } from "../shared/zora";

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = TextBlock;

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

function buildImageReferenceBlock(attachment: FileAttachment): TextBlock {
  return {
    type: "text",
    text: [
      `图片附件：${attachment.name}`,
      `attachmentId: ${attachment.id}`,
      "用户传入了图片，你必须要调用 Inspect Image 工具并传入该 attachmentId 查看图片内容。",
    ].join("\n"),
  };
}

export function resolveAttachmentContent(
  attachments: FileAttachment[]
): ResolvedAttachmentContent[] {
  const content: ResolvedAttachmentContent[] = [];

  for (const attachment of attachments) {
    try {
      switch (attachment.category) {
        case "image": {
          content.push(buildImageReferenceBlock(attachment));
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
  attachments: FileAttachment[]
): ContentBlock[] {
  return resolveAttachmentContent(attachments);
}

export function buildMultimodalPrompt(
  text: string,
  attachments: FileAttachment[]
): AsyncIterable<MultimodalUserMessage> {
  const contentBlocks: ContentBlock[] = [];

  if (text) {
    contentBlocks.push({ type: "text", text });
  }

  contentBlocks.push(...attachmentsToContentBlocks(attachments));

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
