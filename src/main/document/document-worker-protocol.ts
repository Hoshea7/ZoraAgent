import type { DocumentFormat } from "../../shared/document-formats";
import type { DocumentLimits } from "./document-limits";
import type { ParsedDocumentSnapshot } from "./document-types";

export interface DocumentWorkerRequest {
  id: string;
  filePath: string;
  format: DocumentFormat;
  fingerprint: string;
  limits: DocumentLimits;
}

export type DocumentWorkerResponse =
  | { id: string; ok: true; snapshot: ParsedDocumentSnapshot }
  | {
      id: string;
      ok: false;
      error: { code?: string; message: string; name?: string };
    };
