import type {
  DocumentPosition,
  DocumentSource,
} from "./document-types";
import type { DocumentFormat } from "../../shared/document-formats";
import { DocumentReadError } from "./document-error";

export interface DocumentCursorV1 {
  version: 1;
  source: DocumentSource;
  fingerprint: string;
  format: DocumentFormat;
  position: DocumentPosition;
}

export function encodeDocumentCursor(cursor: DocumentCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeDocumentCursor(value: string): DocumentCursorV1 {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      !isSource(parsed.source) ||
      typeof parsed.fingerprint !== "string" ||
      !isFormat(parsed.format) ||
      !isPosition(parsed.position)
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as unknown as DocumentCursorV1;
  } catch (error) {
    throw new DocumentReadError("DOCUMENT_CURSOR_INVALID", undefined, {
      cause: error,
    });
  }
}

function isSource(value: unknown): value is DocumentSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    (source.kind === "attachment" && typeof source.attachmentId === "string") ||
    (source.kind === "path" && typeof source.path === "string")
  );
}

function isFormat(value: unknown): value is DocumentFormat {
  return value === "pdf" || value === "docx" || value === "xlsx" || value === "pptx";
}

function isPosition(value: unknown): value is DocumentPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  if (
    (position.kind === "block" ||
      position.kind === "page" ||
      position.kind === "slide") &&
    Number.isInteger(position.index) &&
    Number(position.index) >= 0 &&
    isOffset(position.offset)
  ) {
    return true;
  }
  return (
    position.kind === "sheetRow" &&
    typeof position.sheet === "string" &&
    Number.isInteger(position.row) &&
    Number(position.row) >= 1 &&
    isOffset(position.offset)
  );
}

function isOffset(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}
