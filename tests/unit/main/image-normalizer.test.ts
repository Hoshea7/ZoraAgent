import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageNormalizer } from "@/main/vision/image-normalizer";

describe("ImageNormalizer", () => {
  it("normalizes supported image bytes to PNG or JPEG", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-image-normalizer-"));
    const imagePath = path.join(root, "sample.webp");
    await writeFile(
      imagePath,
      await sharp({
        create: { width: 2, height: 3, channels: 4, background: "red" },
      }).webp().toBuffer()
    );

    const result = await new ImageNormalizer().normalize(imagePath, "image/webp", 10_000);

    expect(["image/png", "image/jpeg"]).toContain(result.mimeType);
    expect(result.width).toBe(2);
    expect(result.height).toBe(3);
    expect(result.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("rejects a declared image whose magic bytes do not identify an image", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-image-normalizer-"));
    const imagePath = path.join(root, "fake.png");
    await writeFile(imagePath, "not an image");

    await expect(
      new ImageNormalizer().normalize(imagePath, "image/png", 12)
    ).rejects.toThrow("IMAGE_TYPE_MISMATCH");
  });

  it("rejects an attachment above the byte limit before reading it", async () => {
    await expect(
      new ImageNormalizer().normalize("/missing.png", "image/png", 10 * 1024 * 1024 + 1)
    ).rejects.toThrow("IMAGE_TOO_LARGE");
  });
});
