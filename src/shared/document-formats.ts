export const DOCUMENT_FORMATS = {
  ".pdf": { format: "pdf", mimeType: "application/pdf" },
  ".docx": {
    format: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".xlsx": {
    format: "xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ".pptx": {
    format: "pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
} as const;

export type DocumentExtension = keyof typeof DOCUMENT_FORMATS;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[DocumentExtension]["format"];

export const DOCUMENT_EXTENSIONS = Object.keys(
  DOCUMENT_FORMATS
) as DocumentExtension[];

export const DOCUMENT_MIME_TYPES = Object.fromEntries(
  Object.entries(DOCUMENT_FORMATS).map(([extension, entry]) => [
    extension,
    entry.mimeType,
  ])
) as Record<DocumentExtension, string>;

export function documentFormatFromFileName(
  fileName: string
): DocumentFormat | undefined {
  const extension = `.${fileName.split(".").pop()?.toLowerCase() ?? ""}`;
  return DOCUMENT_FORMATS[extension as DocumentExtension]?.format;
}

export function isDocumentExtension(extension: string): boolean {
  return extension.toLowerCase() in DOCUMENT_FORMATS;
}
