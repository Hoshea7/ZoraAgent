export interface DocumentLimits {
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
  maxSnapshotBytes: number;
}

export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = {
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
  // 解析产物的单文件上限。盖住小体积大内容的结构炸弹（如十万段落 docx），
  // 也封住 pdf/xlsx 极端文本密度下的 snapshot 膨胀。
  maxSnapshotBytes: 96 * 1024 * 1024,
};
