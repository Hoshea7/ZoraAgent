import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_SIZE_LIMITS,
  formatAttachmentSizeLimits,
  getAttachmentSizeLimit,
} from "@/shared/attachment-limits";

describe("getAttachmentSizeLimit", () => {
  it("图片按 10MB 限制", () => {
    for (const name of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp"]) {
      expect(getAttachmentSizeLimit(name)).toBe(ATTACHMENT_SIZE_LIMITS.image);
    }
  });

  it("PDF 按 64MB 限制", () => {
    expect(getAttachmentSizeLimit("report.pdf")).toBe(
      ATTACHMENT_SIZE_LIMITS.pdf
    );
    expect(getAttachmentSizeLimit("REPORT.PDF")).toBe(
      ATTACHMENT_SIZE_LIMITS.pdf
    );
  });

  it("PPTX 按 200MB 限制", () => {
    expect(getAttachmentSizeLimit("deck.pptx")).toBe(
      ATTACHMENT_SIZE_LIMITS.pptx
    );
  });

  it("DOCX/XLSX 与文本按 100MB 默认限制", () => {
    for (const name of [
      "doc.docx",
      "sheet.xlsx",
      "note.txt",
      "index.ts",
      "data.csv",
    ]) {
      expect(getAttachmentSizeLimit(name)).toBe(
        ATTACHMENT_SIZE_LIMITS.default
      );
    }
  });

  it("无扩展名或未知扩展名走默认限制", () => {
    expect(getAttachmentSizeLimit("README")).toBe(
      ATTACHMENT_SIZE_LIMITS.default
    );
    expect(getAttachmentSizeLimit("archive.zip")).toBe(
      ATTACHMENT_SIZE_LIMITS.default
    );
  });
});

describe("formatAttachmentSizeLimits", () => {
  it("提示文案覆盖全部档位", () => {
    const message = formatAttachmentSizeLimits();
    expect(message).toContain("10 MB");
    expect(message).toContain("64 MB");
    expect(message).toContain("200 MB");
    expect(message).toContain("100 MB");
  });
});
