import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FileAttachment } from "../../shared/zora";
import { getAttachmentFormat } from "../../shared/attachment-formats";
import { getAttachmentSizeLimit } from "../../shared/attachment-limits";
import { makeImageThumbnail } from "./image-thumbnail";

export async function buildFileAttachment(filePath: string): Promise<FileAttachment | null> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    const format = getAttachmentFormat(filePath);
    const reference = stats.size > getAttachmentSizeLimit(filePath);
    const attachment: FileAttachment = {
      id: randomUUID(), name: path.basename(filePath), ...format,
      category: reference ? "file" : format.category,
      size: stats.size, localPath: path.resolve(filePath),
      ...(reference ? { storageMode: "reference" as const } : {}),
    };
    if (attachment.category === "image") attachment.base64Data = await makeImageThumbnail(filePath);
    return attachment;
  } catch {
    return null;
  }
}
