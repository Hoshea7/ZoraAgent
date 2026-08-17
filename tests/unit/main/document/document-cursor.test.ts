import {
  decodeDocumentCursor,
  encodeDocumentCursor,
} from "@/main/document/document-cursor";
import { DocumentReadError } from "@/main/document/document-error";

describe("document cursor", () => {
  it("round-trips a versioned cursor", () => {
    const cursor = {
      version: 1 as const,
      source: { kind: "attachment" as const, attachmentId: "attachment-1" },
      fingerprint: "fingerprint",
      format: "pdf" as const,
      position: { kind: "page" as const, index: 2, offset: 10 },
    };
    expect(decodeDocumentCursor(encodeDocumentCursor(cursor))).toEqual(cursor);
  });

  it.each(["", "not-json", Buffer.from('{"version":2}').toString("base64url")])(
    "rejects invalid cursor %s",
    (value) => {
      expect(() => decodeDocumentCursor(value)).toThrowError(
        expect.objectContaining<DocumentReadError>({ code: "DOCUMENT_CURSOR_INVALID" })
      );
    }
  );
});
