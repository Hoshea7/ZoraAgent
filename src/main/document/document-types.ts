import type { DocumentFormat } from "../../shared/document-formats";

export type DocumentSource =
  | { kind: "attachment"; attachmentId: string }
  | { kind: "path"; path: string };

export type DocumentSelection =
  | { kind: "pages"; start: number; end?: number }
  | { kind: "slides"; start: number; end?: number }
  | { kind: "sheetRows"; sheet: string; startRow?: number; endRow?: number }
  | { kind: "start" };

export type DocumentReadRequest =
  | {
      source: DocumentSource;
      selection?: DocumentSelection;
      cursor?: never;
      maxOutputBytes?: number;
    }
  | {
      cursor: string;
      source?: never;
      selection?: never;
      maxOutputBytes?: number;
    };

export interface DocumentReadContext {
  workspaceId: string;
  sessionId: string;
  workingDirectory: string;
  signal: AbortSignal;
}

export interface DocumentWarning {
  code: string;
  message: string;
}

export interface DocumentMetadata {
  pages?: number;
  slides?: number;
  sheets?: Array<{ name: string; rows?: number; hidden?: boolean }>;
}

export interface DocumentLocation {
  pages?: { start: number; end: number };
  slides?: { start: number; end: number };
  sheetRows?: { sheet: string; startRow: number; endRow: number };
  blockRange?: { start: number; end: number };
}

export interface DocumentReadResult {
  status: "ok";
  document: {
    name: string;
    format: DocumentFormat;
    sizeBytes: number;
    fingerprint: string;
  };
  metadata: DocumentMetadata;
  location: DocumentLocation;
  content: string;
  truncated: boolean;
  nextCursor?: string;
  warnings: DocumentWarning[];
  safety: { untrustedSource: true };
}

export type DocumentBlock =
  | { kind: "block"; markdown: string }
  | { kind: "page"; page: number; markdown: string }
  | { kind: "slide"; slide: number; markdown: string }
  | {
      kind: "sheetRows";
      sheet: string;
      startRow: number;
      endRow: number;
      markdown: string;
    };

export interface ParsedDocumentSnapshot {
  format: DocumentFormat;
  metadata: DocumentMetadata;
  blocks: DocumentBlock[];
  warnings: DocumentWarning[];
  estimatedBytes: number;
}

export type DocumentPosition =
  | { kind: "block"; index: number; offset?: number }
  | { kind: "page"; index: number; offset?: number }
  | { kind: "slide"; index: number; offset?: number }
  | { kind: "sheetRow"; sheet: string; row: number; offset?: number };
