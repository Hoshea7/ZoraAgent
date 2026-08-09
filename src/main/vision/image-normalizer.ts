import { readFile } from "node:fs/promises";
import sharp from "sharp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;

type NormalizedImageMimeType = "image/png" | "image/jpeg";

export interface NormalizedImage {
  data: string;
  mimeType: NormalizedImageMimeType;
  width: number;
  height: number;
  byteLength: number;
}

const MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function identifyImageFormat(buffer: Buffer): keyof typeof MIME_BY_FORMAT | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return "png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  ) return "gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "webp";
  return null;
}

export class ImageNormalizer {
  async normalize(
    filePath: string,
    declaredMimeType: string,
    declaredSize: number
  ): Promise<NormalizedImage> {
    if (declaredSize > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
    const input = await readFile(filePath);
    if (input.byteLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
    const format = identifyImageFormat(input);
    if (!format || MIME_BY_FORMAT[format] !== declaredMimeType) {
      throw new Error("IMAGE_TYPE_MISMATCH");
    }

    const pipeline = sharp(input, {
      animated: false,
      pages: 1,
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).rotate();
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.pageHeight ?? metadata.height ?? 0;
    if (width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) {
      throw new Error("IMAGE_PIXEL_LIMIT_EXCEEDED");
    }

    const preserveAlpha = metadata.hasAlpha === true;
    const output = preserveAlpha
      ? await pipeline.png().toBuffer()
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return {
      data: output.toString("base64"),
      mimeType: preserveAlpha ? "image/png" : "image/jpeg",
      width,
      height,
      byteLength: output.byteLength,
    };
  }
}
