import { documentFormatFromFileName } from "./document-formats";

const MB = 1024 * 1024;

export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
] as const;

// 入口大小限制按文件类型分层。依据是各格式解析链路的实测开销：
// - image: 10MB，约束是预览数据过 IPC 与驻留内存
// - pdf: 64MB，pdfjs 解析峰值内存约为文件字节的 25 倍
// - pptx: 200MB，媒体资源不参与文本提取，字节数几乎不影响解析
// - default（docx/xlsx/文本）: 100MB，真实闸门在解压上限与结构上限
export const ATTACHMENT_SIZE_LIMITS = {
  image: 10 * MB,
  pdf: 64 * MB,
  pptx: 200 * MB,
  default: 100 * MB,
} as const;

export function getAttachmentSizeLimit(fileName: string): number {
  const format = documentFormatFromFileName(fileName);
  if (format === "pdf") return ATTACHMENT_SIZE_LIMITS.pdf;
  if (format === "pptx") return ATTACHMENT_SIZE_LIMITS.pptx;
  if (format) return ATTACHMENT_SIZE_LIMITS.default;

  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    return ATTACHMENT_SIZE_LIMITS.image;
  }
  return ATTACHMENT_SIZE_LIMITS.default;
}

export function formatAttachmentSizeLimits(): string {
  return "图片不超过 10 MB，PDF 不超过 64 MB，PPT 不超过 200 MB，其他文件不超过 100 MB";
}
