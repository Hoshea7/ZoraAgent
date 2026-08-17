import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import {
  documentFormatFromFileName,
  type DocumentFormat,
} from "../../shared/document-formats";
import { DocumentReadError } from "./document-error";

const MIME_TO_FORMAT: Record<string, DocumentFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
};

export async function detectDocumentFormat(
  filePath: string,
  originalName = path.basename(filePath)
): Promise<DocumentFormat> {
  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch (error) {
    throw new DocumentReadError("DOCUMENT_SOURCE_NOT_FOUND", originalName, {
      cause: error,
    });
  }
  return detectDocumentFormatFromBuffer(data, originalName);
}

export async function detectDocumentFormatFromBuffer(
  data: Uint8Array,
  originalName: string
): Promise<DocumentFormat> {
  const expected = documentFormatFromFileName(originalName);
  const detected = await fileTypeFromBuffer(data);
  const actual = detected ? MIME_TO_FORMAT[detected.mime] : undefined;

  if (!actual) {
    throw new DocumentReadError(
      "DOCUMENT_UNSUPPORTED_FORMAT",
      originalName
    );
  }
  if (expected && expected !== actual) {
    throw new DocumentReadError("DOCUMENT_FORMAT_MISMATCH", originalName);
  }
  return actual;
}

export async function isSupportedDocumentPath(filePath: string): Promise<boolean> {
  try {
    await detectDocumentFormat(filePath);
    return true;
  } catch (error) {
    if (
      error instanceof DocumentReadError &&
      (error.code === "DOCUMENT_UNSUPPORTED_FORMAT" ||
        error.code === "DOCUMENT_SOURCE_NOT_FOUND")
    ) {
      return false;
    }
    if (
      error instanceof DocumentReadError &&
      error.code === "DOCUMENT_FORMAT_MISMATCH"
    ) {
      return true;
    }
    return false;
  }
}
