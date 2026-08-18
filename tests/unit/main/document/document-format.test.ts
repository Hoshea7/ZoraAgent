import { detectDocumentFormatFromBuffer } from "@/main/document/document-format";
import { DocumentReadError } from "@/main/document/document-error";
import {
  createDocxFixture,
  createPdfFixture,
  createPptxFixture,
  createXlsxFixture,
} from "../../../helpers/document-fixtures";

describe("document format detection", () => {
  it.each([
    ["report.pdf", createPdfFixture(), "pdf"],
    ["report.docx", createDocxFixture(), "docx"],
    ["report.xlsx", createXlsxFixture(), "xlsx"],
    ["report.pptx", createPptxFixture(), "pptx"],
  ] as const)("detects %s from verified bytes", async (name, data, format) => {
    await expect(detectDocumentFormatFromBuffer(data, name)).resolves.toBe(format);
  });

  it("rejects an extension and content mismatch", async () => {
    await expect(
      detectDocumentFormatFromBuffer(createPdfFixture(), "report.docx")
    ).rejects.toMatchObject<DocumentReadError>({ code: "DOCUMENT_FORMAT_MISMATCH" });
  });

  it("rejects unknown binary data", async () => {
    await expect(
      detectDocumentFormatFromBuffer(Buffer.from([1, 2, 3]), "unknown.bin")
    ).rejects.toMatchObject<DocumentReadError>({ code: "DOCUMENT_UNSUPPORTED_FORMAT" });
  });
});
