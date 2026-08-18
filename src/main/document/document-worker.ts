import { parentPort } from "node:worker_threads";
import * as XLSX from "@e965/xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import {
  parseOffice,
  type OfficeContentNode,
  type OfficeError,
  type OfficeParserAST,
} from "officeparser";
import type { DocumentBlock, ParsedDocumentSnapshot } from "./document-types";
import type {
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from "./document-worker-protocol";
import { readFile } from "node:fs/promises";
import { DocumentSnapshotCache } from "./document-cache";

interface OfficeIssueLike {
  code: string;
  message: string;
}

const cache = new DocumentSnapshotCache();

parentPort?.on("message", async (request: DocumentWorkerRequest) => {
  let response: DocumentWorkerResponse;
  try {
    let snapshot = cache.get(request.fingerprint);
    if (!snapshot) {
      snapshot = await parseDocument(request);
      cache.set(
        request.fingerprint,
        snapshot,
        request.limits.workerCacheMaxBytes
      );
    }
    response = { id: request.id, ok: true, snapshot };
  } catch (error) {
    const officeError = error as OfficeError;
    response = {
      id: request.id,
      ok: false,
      error: {
        code: officeError.officeIssue?.code,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
      },
    };
  }
  parentPort?.postMessage(response);
});

export async function parseDocument(
  request: DocumentWorkerRequest
): Promise<ParsedDocumentSnapshot> {
  if (request.format === "pdf") return parsePdf(request);
  return parseOfficeDocument(request);
}

async function parsePdf(
  request: DocumentWorkerRequest
): Promise<ParsedDocumentSnapshot> {
  const data = await readFile(request.filePath);
  const pdf = await getDocumentProxy(new Uint8Array(data));
  try {
    if (pdf.numPages > request.limits.maxPdfPages) {
      throw codedError("DOCUMENT_TOO_COMPLEX");
    }
    const result = await extractText(pdf, { mergePages: false });
    const pages = result.text.map((text, index) => ({
      kind: "page" as const,
      page: index + 1,
      markdown: normalizeText(text),
    }));
    if (!pages.some((page) => page.markdown.length > 0)) {
      throw codedError("DOCUMENT_TEXT_LAYER_EMPTY");
    }
    return makeSnapshot("pdf", { pages: result.totalPages }, pages, []);
  } finally {
    const disposable = pdf as unknown as {
      destroy?: () => Promise<void>;
      cleanup?: () => Promise<unknown>;
    };
    if (typeof disposable.destroy === "function") await disposable.destroy();
    else if (typeof disposable.cleanup === "function") await disposable.cleanup();
  }
}

async function parseOfficeDocument(
  request: DocumentWorkerRequest
): Promise<ParsedDocumentSnapshot> {
  const warnings: OfficeIssueLike[] = [];
  const ast = await parseOffice(request.filePath, {
    fileType: request.format,
    extractAttachments: false,
    includeRawContent: false,
    ocr: false,
    ignoreSlideMasters: true,
    decompressionLimits: {
      maxZipEntries: request.limits.maxZipEntries,
      maxUncompressedBytes: request.limits.maxUncompressedBytes,
      maxTableCells: request.limits.maxXlsxCells,
    },
    onWarning: (warning) => warnings.push(warning),
  });

  if (request.format === "pptx") return normalizePresentation(ast, warnings, request);
  if (request.format === "xlsx") return normalizeWorkbook(request, warnings);
  return normalizeWord(ast, warnings);
}

function normalizeWord(
  ast: OfficeParserAST,
  warnings: OfficeIssueLike[]
): ParsedDocumentSnapshot {
  const blocks = ast.content
    .map((node) => renderNode(node))
    .filter(Boolean)
    .map((markdown) => ({ kind: "block" as const, markdown }));
  return makeSnapshot("docx", {}, blocks, warnings);
}

function normalizePresentation(
  ast: OfficeParserAST,
  warnings: OfficeIssueLike[],
  request: DocumentWorkerRequest
): ParsedDocumentSnapshot {
  const slides = ast.content.filter((node) => node.type === "slide");
  if (slides.length > request.limits.maxPptxSlides) {
    throw codedError("DOCUMENT_TOO_COMPLEX");
  }
  const blocks: DocumentBlock[] = slides.map((slide, index) => ({
    kind: "slide",
    slide: slide.metadata?.slideNumber ?? index + 1,
    markdown: renderChildren(slide),
  }));
  return makeSnapshot("pptx", { slides: slides.length }, blocks, warnings);
}

async function normalizeWorkbook(
  request: DocumentWorkerRequest,
  warnings: OfficeIssueLike[]
): Promise<ParsedDocumentSnapshot> {
  const data = await readFile(request.filePath);
  const workbook = XLSX.read(data, {
    bookVBA: false,
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellText: true,
    sheetStubs: true,
    type: "buffer",
    WTF: true,
  });
  if (workbook.SheetNames.length > request.limits.maxXlsxSheets) {
    throw codedError("DOCUMENT_TOO_COMPLEX");
  }
  let cellCount = 0;
  const blocks: DocumentBlock[] = [];
  const metadataSheets: Array<{ name: string; rows: number; hidden?: boolean }> = [];

  for (const [sheetIndex, sheetName] of workbook.SheetNames.entries()) {
    const worksheet = workbook.Sheets[sheetName];
    const mergedByMaster = new Map<string, string>();
    for (const range of worksheet["!merges"] ?? []) {
      mergedByMaster.set(XLSX.utils.encode_cell(range.s), XLSX.utils.encode_range(range));
    }
    let lastPopulatedRow = 0;
    const rows = new Map<number, Array<{ column: number; text: string }>>();
    for (const address of Object.keys(worksheet)) {
      if (address.startsWith("!")) continue;
      const cell = worksheet[address] as XLSX.CellObject;
      if (!cell || (cell.v === undefined && !cell.f)) continue;
      cellCount += 1;
      if (cellCount > request.limits.maxXlsxCells) {
        throw codedError("DOCUMENT_TOO_COMPLEX");
      }
      const position = XLSX.utils.decode_cell(address);
      const column = XLSX.utils.encode_col(position.c);
      const mergedRange = mergedByMaster.get(address);
      const value = formatSpreadsheetCell(cell);
      const row = rows.get(position.r) ?? [];
      row.push({
        column: position.c,
        text: `${column}: ${mergedRange ? `[合并 ${mergedRange}] ` : ""}${escapeMarkdown(value)}`,
      });
      rows.set(position.r, row);
    }
    for (const [zeroBasedRow, cells] of [...rows.entries()].sort(([left], [right]) => left - right)) {
      const rowNumber = zeroBasedRow + 1;
      lastPopulatedRow = rowNumber;
      blocks.push({
        kind: "sheetRows",
        sheet: sheetName,
        startRow: rowNumber,
        endRow: rowNumber,
        markdown: `| ${rowNumber} | ${cells.sort((left, right) => left.column - right.column).map((cell) => cell.text).join(" | ")} |`,
      });
    }
    const sheetProperties = workbook.Workbook?.Sheets?.[sheetIndex];
    metadataSheets.push({
      name: sheetName,
      rows: lastPopulatedRow,
      ...(sheetProperties?.Hidden ? { hidden: true } : {}),
    });
  }
  return makeSnapshot("xlsx", { sheets: metadataSheets }, blocks, warnings);
}

function formatSpreadsheetCell(cell: XLSX.CellObject): string {
  if (cell.f) {
    return cell.v === undefined || cell.t === "z"
      ? `=${cell.f}`
      : `=${cell.f} => ${formatSpreadsheetValue(cell)}`;
  }
  return formatSpreadsheetValue(cell);
}

function formatSpreadsheetValue(cell: XLSX.CellObject): string {
  if (cell.v === undefined) return "";
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  const value = cell.w ?? String(cell.v);
  return cell.l?.Target ? `${value} (${cell.l.Target})` : value;
}

function renderNode(node: OfficeContentNode): string {
  const text = normalizeText(node.text ?? renderChildren(node));
  if (node.type === "heading") {
    return `${"#".repeat(Math.min(6, Math.max(1, node.metadata?.level ?? 1)))} ${text}`;
  }
  if (node.type === "list") {
    return `${node.metadata?.listType === "ordered" ? "1." : "-"} ${text}`;
  }
  if (node.type === "paragraph" && /^ListBullet/i.test(node.metadata?.style ?? "")) {
    return `- ${text}`;
  }
  if (node.type === "paragraph" && /^ListNumber/i.test(node.metadata?.style ?? "")) {
    return `1. ${text}`;
  }
  if (node.type === "table") return renderTable(node);
  if (node.type === "image" || node.type === "drawing") return "[图片]";
  if (node.type === "chart") return text ? `[图表] ${text}` : "[图表]";
  return text;
}

function renderChildren(node: OfficeContentNode): string {
  const content = (node.children ?? []).map(renderNode).filter(Boolean);
  const notes = (node.notes ?? []).map(renderNode).filter(Boolean);
  if (notes.length > 0) content.push(`### 备注\n${notes.join("\n")}`);
  return content.join("\n");
}

function renderTable(node: OfficeContentNode): string {
  const rows = (node.children ?? []).filter((child) => child.type === "row");
  return rows
    .map((row) => {
      const cells = (row.children ?? []).filter((child) => child.type === "cell");
      return `| ${cells.map((cell) => escapeMarkdown(normalizeText(cell.text ?? renderChildren(cell)))).join(" | ")} |`;
    })
    .join("\n");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function makeSnapshot(
  format: ParsedDocumentSnapshot["format"],
  metadata: ParsedDocumentSnapshot["metadata"],
  blocks: DocumentBlock[],
  warnings: OfficeIssueLike[]
): ParsedDocumentSnapshot {
  const mappedWarnings = warnings.map((warning) => ({
    code: String(warning.code),
    message: warning.message,
  }));
  const estimatedBytes = Buffer.byteLength(JSON.stringify({ metadata, blocks, mappedWarnings }));
  return { format, metadata, blocks, warnings: mappedWarnings, estimatedBytes };
}

function codedError(code: string): Error {
  const error = new Error(code) as Error & { officeIssue?: { code: string } };
  error.officeIssue = { code };
  return error;
}
