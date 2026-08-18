export type DocumentErrorCode =
  | "DOCUMENT_SOURCE_NOT_FOUND"
  | "DOCUMENT_SOURCE_FORBIDDEN"
  | "DOCUMENT_UNSUPPORTED_FORMAT"
  | "DOCUMENT_FORMAT_MISMATCH"
  | "DOCUMENT_TOO_LARGE"
  | "DOCUMENT_TOO_COMPLEX"
  | "DOCUMENT_PASSWORD_PROTECTED"
  | "DOCUMENT_CORRUPTED"
  | "DOCUMENT_TEXT_LAYER_EMPTY"
  | "DOCUMENT_PARSE_TIMEOUT"
  | "DOCUMENT_CURSOR_INVALID"
  | "DOCUMENT_CHANGED"
  | "DOCUMENT_SELECTION_INVALID"
  | "DOCUMENT_ABORTED"
  | "DOCUMENT_INTERNAL_ERROR";

const USER_MESSAGES: Record<DocumentErrorCode, string> = {
  DOCUMENT_SOURCE_NOT_FOUND: "文件不存在或已移动。",
  DOCUMENT_SOURCE_FORBIDDEN: "该附件不属于当前会话。",
  DOCUMENT_UNSUPPORTED_FORMAT: "当前只支持 PDF、DOCX、XLSX、PPTX。",
  DOCUMENT_FORMAT_MISMATCH: "文件扩展名与实际格式不一致。",
  DOCUMENT_TOO_LARGE: "文件超过当前读取大小限制。",
  DOCUMENT_TOO_COMPLEX: "文档结构超过当前读取限制。",
  DOCUMENT_PASSWORD_PROTECTED: "文件受密码保护，当前无法读取。",
  DOCUMENT_CORRUPTED: "文件结构损坏，无法提取正文。",
  DOCUMENT_TEXT_LAYER_EMPTY: "PDF 没有可提取文本，本期暂不支持扫描件。",
  DOCUMENT_PARSE_TIMEOUT: "文档解析超过时间限制。",
  DOCUMENT_CURSOR_INVALID: "续读位置无效，请从文档开头重新读取。",
  DOCUMENT_CHANGED: "文件已变化，请重新开始读取。",
  DOCUMENT_SELECTION_INVALID: "读取范围不适用于该文件。",
  DOCUMENT_ABORTED: "文档读取已取消。",
  DOCUMENT_INTERNAL_ERROR: "文档读取失败，原因未查明。",
};

export class DocumentReadError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    readonly fileName?: string,
    options?: ErrorOptions
  ) {
    super(USER_MESSAGES[code], options);
    this.name = "DocumentReadError";
  }

  toJSON() {
    return {
      status: "error",
      code: this.code,
      message: this.message,
      fileName: this.fileName,
      nextStep: nextStepFor(this.code),
    };
  }
}

function nextStepFor(code: DocumentErrorCode): string {
  if (code === "DOCUMENT_TEXT_LAYER_EMPTY") {
    return "请提供带文本层的 PDF，或将扫描内容转成图片后读取。";
  }
  if (code === "DOCUMENT_CHANGED" || code === "DOCUMENT_CURSOR_INVALID") {
    return "请不带 cursor 重新调用 read_document。";
  }
  return "请检查文件和读取参数后重试。";
}
