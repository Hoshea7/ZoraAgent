import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeImageThumbnail } from "@/main/attachments/image-thumbnail";

describe("makeImageThumbnail", () => {
  it("生成不超过 512px 长边的 jpeg 缩略图", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-thumbnail-"));
    const sourcePath = path.join(directory, "source.png");
    await writeFile(
      sourcePath,
      await sharp({
        create: { width: 1024, height: 512, channels: 3, background: "#ff8800" },
      })
        .png()
        .toBuffer()
    );

    const base64 = await makeImageThumbnail(sourcePath);
    const buffer = Buffer.from(base64, "base64");
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(512);
    expect(buffer.byteLength).toBeLessThan(50 * 1024);
  });

  it("透明 PNG 压平为白底，避免 jpeg 黑底", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-thumbnail-"));
    const sourcePath = path.join(directory, "alpha.png");
    const rgba = Buffer.from(
      Array.from({ length: 64 * 64 * 4 }, (_, index) =>
        index % 4 === 3 ? 0 : 255
      )
    );
    await writeFile(sourcePath, await sharp(rgba, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer());

    const base64 = await makeImageThumbnail(sourcePath);
    const { info, data } = await sharp(Buffer.from(base64, "base64"))
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.channels).toBe(3);
    const firstPixel = Array.from(data.subarray(0, 3));
    expect(firstPixel).toEqual([255, 255, 255]);
  });
});
