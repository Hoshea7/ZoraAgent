import { readFileSync } from "node:fs";
import path from "node:path";
import type { FileAttachment } from "../shared/zora";

type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

interface TextBlock {
  type: "text";
  text: string;
}

interface ImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: SupportedImageMediaType;
    data: string;
  };
}

type ContentBlock = TextBlock | ImageBlock;

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

function isSupportedImageMediaType(mimeType: string): mimeType is SupportedImageMediaType {
  return (
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/gif" ||
    mimeType === "image/webp"
  );
}

export function attachmentsToContentBlocks(
  attachments: FileAttachment[]
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const attachment of attachments) {
    try {
      switch (attachment.category) {
        case "image": {
          const base64Data =
            attachment.base64Data ||
            (attachment.localPath
              ? readFileSync(attachment.localPath).toString("base64")
              : "");

          if (!base64Data || !isSupportedImageMediaType(attachment.mimeType)) {
            continue;
          }

          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: attachment.mimeType,
              data: base64Data,
            },
          });
          break;
        }

        case "document": {
          blocks.push(buildPdfFallbackBlock(attachment));
          break;
        }

        case "text": {
          if (!attachment.localPath) {
            continue;
          }

          blocks.push(
            buildTextAttachmentBlock(
              attachment,
              readFileSync(attachment.localPath, "utf-8")
            )
          );
          break;
        }
      }
    } catch (error) {
      console.warn(
        `[attachment-handler] Failed to read attachment "${attachment.name}".`,
        error
      );
    }
  }

  return blocks;
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
