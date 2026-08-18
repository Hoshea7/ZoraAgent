import { readFile } from "node:fs/promises";
import sharp from "sharp";

export const THUMBNAIL_SUFFIX = ".thumb.jpg";

const THUMBNAIL_EDGE = 512;

/**
 * 生成 512px 长边的 jpeg 缩略图（白底压平），作为图片附件在 UI 与
 * 会话恢复中的预览数据。原图只存盘，缩略图常驻内存与消息列表。
 */
export async function makeImageThumbnail(sourcePath: string): Promise<string> {
  const input = await readFile(sourcePath);
  const buffer = await sharp(input, { animated: false, pages: 1 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return buffer.toString("base64");
}
