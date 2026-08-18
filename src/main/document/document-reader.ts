import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { getAttachmentSizeLimit } from "../../shared/attachment-limits";
import { attachmentResourceModule, type ResolvedAttachment } from "../attachment-resource";
import { detectDocumentFormatFromBuffer } from "./document-format";
import {
  DEFAULT_DOCUMENT_LIMITS,
  type DocumentLimits,
} from "./document-limits";
import { DocumentReadError } from "./document-error";
import {
  decodeDocumentCursor,
  encodeDocumentCursor,
} from "./document-cursor";
import type {
  DocumentBlock,
  DocumentLocation,
  DocumentPosition,
  DocumentReadContext,
  DocumentReadRequest,
  DocumentReadResult,
  DocumentSelection,
  DocumentSource,
  ParsedDocumentSnapshot,
} from "./document-types";
import {
  DocumentWorkerClient,
  type DocumentParser,
} from "./document-worker-client";
import type { DocumentFormat } from "../../shared/document-formats";

interface AttachmentResolver {
  resolve(
    workspaceId: string,
    sessionId: string,
    attachmentId: string
  ): Promise<ResolvedAttachment>;
}

interface DocumentReaderDependencies {
  attachments: AttachmentResolver;
  parser: DocumentParser;
  limits: DocumentLimits;
}

interface ResolvedSource {
  source: DocumentSource;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  fingerprint: string;
  format: DocumentFormat;
}

const defaultWorkerClient = new DocumentWorkerClient();

export class DocumentReaderModule {
  constructor(
    private readonly dependencies: DocumentReaderDependencies = {
      attachments: attachmentResourceModule,
      parser: defaultWorkerClient,
      limits: DEFAULT_DOCUMENT_LIMITS,
    }
  ) {}

  async read(
    request: DocumentReadRequest,
    context: DocumentReadContext
  ): Promise<DocumentReadResult> {
    if (context.signal.aborted) {
      throw new DocumentReadError("DOCUMENT_ABORTED");
    }
    const cursor = request.cursor
      ? decodeDocumentCursor(request.cursor)
      : undefined;
    const source = cursor?.source ?? request.source;
    if (!source) throw new DocumentReadError("DOCUMENT_CURSOR_INVALID");
    const resolved = await this.resolveSource(source, context);
    if (cursor && cursor.fingerprint !== resolved.fingerprint) {
      throw new DocumentReadError("DOCUMENT_CHANGED", resolved.fileName);
    }
    if (cursor && cursor.format !== resolved.format) {
      throw new DocumentReadError("DOCUMENT_CURSOR_INVALID", resolved.fileName);
    }
    const snapshot = await this.dependencies.parser.parse({
      filePath: resolved.filePath,
      fileName: resolved.fileName,
      format: resolved.format,
      fingerprint: resolved.fingerprint,
      limits: this.dependencies.limits,
      signal: context.signal,
    });
    if (snapshot.estimatedBytes > this.dependencies.limits.maxSnapshotBytes) {
      throw new DocumentReadError("DOCUMENT_TOO_COMPLEX", resolved.fileName);
    }
    const selection = cursor ? undefined : request.selection;
    validateSelection(resolved.format, selection, snapshot);
    const page = paginate(
      snapshot,
      selection,
      cursor?.position,
      Math.min(
        request.maxOutputBytes ?? this.dependencies.limits.toolOutputMaxBytes,
        this.dependencies.limits.toolOutputMaxBytes
      ),
      this.dependencies.limits
    );
    return {
      status: "ok",
      document: {
        name: resolved.fileName,
        format: resolved.format,
        sizeBytes: resolved.sizeBytes,
        fingerprint: resolved.fingerprint,
      },
      metadata: snapshot.metadata,
      location: page.location,
      content: page.content,
      truncated: Boolean(page.nextPosition),
      nextCursor: page.nextPosition
        ? encodeDocumentCursor({
            version: 1,
            source: resolved.source,
            fingerprint: resolved.fingerprint,
            format: resolved.format,
            position: page.nextPosition,
          })
        : undefined,
      warnings: snapshot.warnings,
      safety: { untrustedSource: true },
    };
  }

  close(): Promise<void> {
    return this.dependencies.parser.close();
  }

  private async resolveSource(
    source: DocumentSource,
    context: DocumentReadContext
  ): Promise<ResolvedSource> {
    if (source.kind === "attachment") {
      let attachment: ResolvedAttachment;
      try {
        attachment = await this.dependencies.attachments.resolve(
          context.workspaceId,
          context.sessionId,
          source.attachmentId
        );
      } catch (error) {
        throw new DocumentReadError("DOCUMENT_SOURCE_FORBIDDEN", undefined, {
          cause: error,
        });
      }
      if (attachment.record.category !== "document") {
        throw new DocumentReadError(
          "DOCUMENT_SOURCE_FORBIDDEN",
          attachment.record.filename
        );
      }
      return resolveFile(
        source,
        attachment.filePath,
        attachment.record.filename
      );
    }
    const resolvedPath = path.resolve(context.workingDirectory, source.path);
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(resolvedPath);
    } catch (error) {
      throw new DocumentReadError(
        "DOCUMENT_SOURCE_NOT_FOUND",
        path.basename(source.path),
        { cause: error }
      );
    }
    return resolveFile(
      { kind: "path", path: source.path },
      canonicalPath,
      path.basename(canonicalPath)
    );
  }
}

async function resolveFile(
  source: DocumentSource,
  filePath: string,
  fileName: string
): Promise<ResolvedSource> {
  const maxBytes = getAttachmentSizeLimit(fileName);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    throw new DocumentReadError("DOCUMENT_SOURCE_NOT_FOUND", fileName, {
      cause: error,
    });
  }
  if (!fileStat.isFile()) {
    throw new DocumentReadError("DOCUMENT_SOURCE_FORBIDDEN", fileName);
  }
  if (fileStat.size > maxBytes) {
    throw new DocumentReadError("DOCUMENT_TOO_LARGE", fileName);
  }
  const data = await readFile(filePath);
  const format = await detectDocumentFormatFromBuffer(data, fileName);
  const fingerprint = createHash("sha256").update(data).digest("hex");
  return { source, filePath, fileName, sizeBytes: fileStat.size, fingerprint, format };
}

interface PageResult {
  content: string;
  location: DocumentLocation;
  nextPosition?: DocumentPosition;
}

interface Unit {
  block: DocumentBlock;
  text: string;
  index: number;
}

function paginate(
  snapshot: ParsedDocumentSnapshot,
  selection: DocumentSelection | undefined,
  position: DocumentPosition | undefined,
  maxBytes: number,
  limits: DocumentLimits
): PageResult {
  const units = selectUnits(snapshot, selection, position, limits);
  if (units.length === 0) {
    throw new DocumentReadError("DOCUMENT_SELECTION_INVALID");
  }
  const offset = position?.offset ?? 0;
  let content = "";
  let last: Unit | undefined;
  for (const unit of units) {
    const unitText = unit.index === units[0].index ? unit.text.slice(offset) : unit.text;
    const separator = content ? "\n\n" : "";
    const remaining = maxBytes - Buffer.byteLength(content + separator);
    if (remaining <= 0) break;
    if (Buffer.byteLength(unitText) > remaining) {
      const chunk = truncateUtf8(unitText, remaining);
      content += separator + chunk;
      return {
        content,
        location: locationFor(units[0], unit),
        nextPosition: positionFor(unit.block, unit.index, (unit.index === units[0].index ? offset : 0) + chunk.length),
      };
    }
    content += separator + unitText;
    last = unit;
  }
  if (!last) throw new DocumentReadError("DOCUMENT_SELECTION_INVALID");
  const lastUnitIndex = units.indexOf(last);
  const hasMore =
    lastUnitIndex < units.length - 1 ||
    hasRemainingUnits(snapshot, selection, last);
  return {
    content,
    location: locationFor(units[0], last),
    nextPosition: hasMore
      ? lastUnitIndex < units.length - 1
        ? positionFor(units[lastUnitIndex + 1].block, units[lastUnitIndex + 1].index, 0)
        : positionAfter(last)
      : undefined,
  };
}

function hasRemainingUnits(
  snapshot: ParsedDocumentSnapshot,
  selection: DocumentSelection | undefined,
  last: Unit
): boolean {
  if (selection && selection.kind !== "start") return false;
  if (last.block.kind === "sheetRows") {
    const lastSheet = last.block.sheet;
    const lastRow = last.block.endRow;
    return snapshot.blocks.some(
      (block) =>
        block.kind === "sheetRows" &&
        block.sheet === lastSheet &&
        block.startRow > lastRow
    );
  }
  return last.index < snapshot.blocks.length - 1;
}

function positionAfter(unit: Unit): DocumentPosition {
  const nextIndex = unit.index + 1;
  if (unit.block.kind === "page") return { kind: "page", index: nextIndex };
  if (unit.block.kind === "slide") return { kind: "slide", index: nextIndex };
  if (unit.block.kind === "sheetRows") {
    return {
      kind: "sheetRow",
      sheet: unit.block.sheet,
      row: unit.block.endRow + 1,
    };
  }
  return { kind: "block", index: nextIndex };
}

function selectUnits(
  snapshot: ParsedDocumentSnapshot,
  selection: DocumentSelection | undefined,
  position: DocumentPosition | undefined,
  limits: DocumentLimits
): Unit[] {
  const all = snapshot.blocks.map((block, index) => ({
    block,
    index,
    text: formatBlock(block),
  }));
  if (snapshot.format === "pdf") {
    const start = position?.kind === "page" ? position.index : selection?.kind === "pages" ? selection.start - 1 : 0;
    const end = selection?.kind === "pages" && selection.end ? selection.end : start + limits.maxPagesPerRead;
    return all.slice(start, Math.min(end, start + limits.maxPagesPerRead));
  }
  if (snapshot.format === "pptx") {
    const start = position?.kind === "slide" ? position.index : selection?.kind === "slides" ? selection.start - 1 : 0;
    const end = selection?.kind === "slides" && selection.end ? selection.end : start + limits.maxSlidesPerRead;
    return all.slice(start, Math.min(end, start + limits.maxSlidesPerRead));
  }
  if (snapshot.format === "xlsx") {
    const sheet = position?.kind === "sheetRow"
      ? position.sheet
      : selection?.kind === "sheetRows"
        ? selection.sheet
        : snapshot.metadata.sheets?.find((item) => !item.hidden)?.name
          ?? snapshot.metadata.sheets?.[0]?.name;
    const startRow = position?.kind === "sheetRow" ? position.row : selection?.kind === "sheetRows" ? selection.startRow ?? 1 : 1;
    const endRow = selection?.kind === "sheetRows" && selection.endRow ? selection.endRow : startRow + limits.maxRowsPerRead - 1;
    return all.filter(({ block }) => block.kind === "sheetRows" && block.sheet === sheet && block.startRow >= startRow && block.startRow <= Math.min(endRow, startRow + limits.maxRowsPerRead - 1));
  }
  const start = position?.kind === "block" ? position.index : 0;
  return all.slice(start);
}

function validateSelection(
  format: DocumentFormat,
  selection: DocumentSelection | undefined,
  snapshot: ParsedDocumentSnapshot
): void {
  if (!selection || selection.kind === "start") return;
  if (format === "pdf" && selection.kind === "pages") {
    validateRange(selection.start, selection.end, snapshot.metadata.pages ?? 0);
    return;
  }
  if (format === "pptx" && selection.kind === "slides") {
    validateRange(selection.start, selection.end, snapshot.metadata.slides ?? 0);
    return;
  }
  if (format === "xlsx" && selection.kind === "sheetRows") {
    const sheet = snapshot.metadata.sheets?.find((item) => item.name === selection.sheet);
    if (!sheet) throw new DocumentReadError("DOCUMENT_SELECTION_INVALID");
    validateRange(selection.startRow ?? 1, selection.endRow, sheet.rows ?? 0);
    return;
  }
  throw new DocumentReadError("DOCUMENT_SELECTION_INVALID");
}

function validateRange(start: number, end: number | undefined, total: number): void {
  if (start < 1 || start > total || (end !== undefined && (end < start || end > total))) {
    throw new DocumentReadError("DOCUMENT_SELECTION_INVALID");
  }
}

function formatBlock(block: DocumentBlock): string {
  if (block.kind === "page") return `## 第 ${block.page} 页\n\n${block.markdown}`;
  if (block.kind === "slide") return `## Slide ${block.slide}\n\n${block.markdown}`;
  if (block.kind === "sheetRows") return block.markdown;
  return block.markdown;
}

function locationFor(first: Unit, last: Unit): DocumentLocation {
  if (first.block.kind === "page" && last.block.kind === "page") return { pages: { start: first.block.page, end: last.block.page } };
  if (first.block.kind === "slide" && last.block.kind === "slide") return { slides: { start: first.block.slide, end: last.block.slide } };
  if (first.block.kind === "sheetRows" && last.block.kind === "sheetRows") {
    return { sheetRows: { sheet: first.block.sheet, startRow: first.block.startRow, endRow: last.block.endRow } };
  }
  return { blockRange: { start: first.index + 1, end: last.index + 1 } };
}

function positionFor(block: DocumentBlock, index: number, offset: number): DocumentPosition {
  if (block.kind === "page") return { kind: "page", index, offset };
  if (block.kind === "slide") return { kind: "slide", index, offset };
  if (block.kind === "sheetRows") return { kind: "sheetRow", sheet: block.sheet, row: block.startRow, offset };
  return { kind: "block", index, offset };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

export const documentReaderModule = new DocumentReaderModule();
