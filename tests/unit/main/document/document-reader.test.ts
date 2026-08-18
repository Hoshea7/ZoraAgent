import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DocumentReaderModule } from "@/main/document/document-reader";
import { DEFAULT_DOCUMENT_LIMITS } from "@/main/document/document-limits";
import { DocumentReadError } from "@/main/document/document-error";
import type { ParsedDocumentSnapshot } from "@/main/document/document-types";
import { createPdfFixture, createXlsxFixture } from "../../../helpers/document-fixtures";

const snapshot: ParsedDocumentSnapshot = {
  format: "pdf",
  metadata: { pages: 3 },
  blocks: [1, 2, 3].map((page) => ({ kind: "page", page, markdown: `page-${page}` })),
  warnings: [],
  estimatedBytes: 100,
};

describe("DocumentReaderModule", () => {
  it("validates attachment ownership and continues with cursor", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-reader-"));
    const filePath = path.join(directory, "stored-file");
    await writeFile(filePath, createPdfFixture());
    const parser = { parse: vi.fn().mockResolvedValue(snapshot), close: vi.fn() };
    const reader = new DocumentReaderModule({
      attachments: {
        resolve: vi.fn().mockResolvedValue({
          record: {
            attachmentId: "4b49ab3c-8c7c-4d89-84f7-743ca6ac14bb",
            storageKey: "5b49ab3c-8c7c-4d89-84f7-743ca6ac14bb",
            filename: "report.pdf",
            mimeType: "application/pdf",
            size: 10,
            category: "document",
          },
          filePath,
        }),
      },
      parser,
      limits: { ...DEFAULT_DOCUMENT_LIMITS, maxPagesPerRead: 1 },
    });
    const context = {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      workingDirectory: directory,
      signal: new AbortController().signal,
    };
    try {
      const first = await reader.read({
        source: { kind: "attachment", attachmentId: "4b49ab3c-8c7c-4d89-84f7-743ca6ac14bb" },
      }, context);
      expect(first.content).toContain("page-1");
      expect(first.nextCursor).toBeDefined();
      const second = await reader.read({ cursor: first.nextCursor! }, context);
      expect(second.content).toContain("page-2");
      expect(parser.parse).toHaveBeenCalledTimes(2);

      await writeFile(filePath, createPdfFixture("changed"));
      await expect(reader.read({ cursor: first.nextCursor! }, context)).rejects.toMatchObject({
        code: "DOCUMENT_CHANGED",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects attachments outside the current session", async () => {
    const reader = new DocumentReaderModule({
      attachments: { resolve: vi.fn().mockRejectedValue(new Error("missing")) },
      parser: { parse: vi.fn(), close: vi.fn() },
      limits: DEFAULT_DOCUMENT_LIMITS,
    });
    await expect(reader.read({
      source: { kind: "attachment", attachmentId: "4b49ab3c-8c7c-4d89-84f7-743ca6ac14bb" },
    }, {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      workingDirectory: "/tmp",
      signal: new AbortController().signal,
    })).rejects.toMatchObject<DocumentReadError>({ code: "DOCUMENT_SOURCE_FORBIDDEN" });
  });

  it("rejects a selection that does not match the document format", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-reader-selection-"));
    const filePath = path.join(directory, "report.pdf");
    await writeFile(filePath, createPdfFixture());
    const reader = new DocumentReaderModule({
      attachments: { resolve: vi.fn() },
      parser: { parse: vi.fn().mockResolvedValue(snapshot), close: vi.fn() },
      limits: DEFAULT_DOCUMENT_LIMITS,
    });
    try {
      await expect(reader.read({
        source: { kind: "path", path: "report.pdf" },
        selection: { kind: "slides", start: 1 },
      }, {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        workingDirectory: directory,
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: "DOCUMENT_SELECTION_INVALID" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("starts spreadsheet reads from the first visible sheet", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-reader-hidden-sheet-"));
    const filePath = path.join(directory, "report.xlsx");
    await writeFile(filePath, createXlsxFixture());
    const workbookSnapshot: ParsedDocumentSnapshot = {
      format: "xlsx",
      metadata: {
        sheets: [
          { name: "Internal", rows: 1, hidden: true },
          { name: "Summary", rows: 1 },
        ],
      },
      blocks: [
        { kind: "sheetRows", sheet: "Internal", startRow: 1, endRow: 1, markdown: "secret" },
        { kind: "sheetRows", sheet: "Summary", startRow: 1, endRow: 1, markdown: "visible" },
      ],
      warnings: [],
      estimatedBytes: 100,
    };
    const reader = new DocumentReaderModule({
      attachments: { resolve: vi.fn() },
      parser: { parse: vi.fn().mockResolvedValue(workbookSnapshot), close: vi.fn() },
      limits: DEFAULT_DOCUMENT_LIMITS,
    });
    try {
      const result = await reader.read({
        source: { kind: "path", path: "report.xlsx" },
      }, {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        workingDirectory: directory,
        signal: new AbortController().signal,
      });
      expect(result.content).toBe("visible");
      expect(result.location.sheetRows?.sheet).toBe("Summary");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("分层附件大小限制", () => {
  it("attachment 与 path 来源使用同一份按格式分层的大小上限", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-reader-size-"));
    // 11MB 的非 PDF 字节：旧的 10MB 一刀切会先抛 DOCUMENT_TOO_LARGE，
    // 分层后 11MB 的 .pdf 落在 64MB 档内，继续走到格式检测。
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 0x20);
    const filePath = path.join(directory, "large.pdf");
    await writeFile(filePath, largeBuffer);
    const record = {
      attachmentId: "6b49ab3c-8c7c-4d89-84f7-743ca6ac14bb",
      storageKey: "7b49ab3c-8c7c-4d89-84f7-743ca6ac14bb",
      filename: "large.pdf",
      mimeType: "application/pdf",
      size: largeBuffer.byteLength,
      category: "document" as const,
    };
    const reader = new DocumentReaderModule({
      attachments: { resolve: vi.fn().mockResolvedValue({ record, filePath }) },
      parser: { parse: vi.fn(), close: vi.fn() },
      limits: DEFAULT_DOCUMENT_LIMITS,
    });
    const context = {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      workingDirectory: directory,
      signal: new AbortController().signal,
    };
    try {
      const viaAttachment = reader.read({
        source: { kind: "attachment", attachmentId: record.attachmentId },
      }, context);
      await expect(viaAttachment).rejects.toMatchObject({
        code: "DOCUMENT_UNSUPPORTED_FORMAT",
      });
      const viaPath = reader.read({ source: { kind: "path", path: "large.pdf" } }, context);
      await expect(viaPath).rejects.toMatchObject({
        code: "DOCUMENT_UNSUPPORTED_FORMAT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("snapshot 体积闸门", () => {
  it("拒绝解析产物超过 maxSnapshotBytes 的文档", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-reader-snapshot-"));
    const filePath = path.join(directory, "bomb.pdf");
    await writeFile(filePath, createPdfFixture());
    const hugeSnapshot: ParsedDocumentSnapshot = {
      ...snapshot,
      estimatedBytes: DEFAULT_DOCUMENT_LIMITS.maxSnapshotBytes + 1,
    };
    const parser = { parse: vi.fn().mockResolvedValue(hugeSnapshot), close: vi.fn() };
    const reader = new DocumentReaderModule({
      attachments: { resolve: vi.fn() },
      parser,
      limits: DEFAULT_DOCUMENT_LIMITS,
    });
    try {
      await expect(reader.read({ source: { kind: "path", path: "bomb.pdf" } }, {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        workingDirectory: directory,
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: "DOCUMENT_TOO_COMPLEX" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
