export interface DocumentLimits {
  attachmentMaxBytes: number;
  pathMaxBytes: number;
  maxPdfPages: number;
  maxPptxSlides: number;
  maxXlsxSheets: number;
  maxXlsxCells: number;
  parseTimeoutMs: number;
  toolOutputMaxBytes: number;
  maxPagesPerRead: number;
  maxSlidesPerRead: number;
  maxRowsPerRead: number;
  workerCacheMaxBytes: number;
  maxZipEntries: number;
  maxUncompressedBytes: number;
}

export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = {
  attachmentMaxBytes: 10 * 1024 * 1024,
  pathMaxBytes: 32 * 1024 * 1024,
  maxPdfPages: 500,
  maxPptxSlides: 500,
  maxXlsxSheets: 100,
  maxXlsxCells: 250_000,
  parseTimeoutMs: 30_000,
  toolOutputMaxBytes: 50 * 1024,
  maxPagesPerRead: 20,
  maxSlidesPerRead: 20,
  maxRowsPerRead: 200,
  workerCacheMaxBytes: 64 * 1024 * 1024,
  maxZipEntries: 10_000,
  maxUncompressedBytes: 128 * 1024 * 1024,
};
