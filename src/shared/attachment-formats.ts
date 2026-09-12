import type { FileAttachment } from "./zora";
import { DOCUMENT_FORMATS } from "./document-formats";

export const TEXT_EXTENSIONS = ["txt", "md", "csv", "json", "xml", "py", "js", "ts", "tsx", "jsx", "html", "css", "go", "rs"] as const;
const imageMime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const textMime: Record<string, string> = {
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
  ".json": "application/json", ".xml": "application/xml", ".py": "text/x-python",
  ".js": "text/javascript", ".ts": "text/typescript", ".tsx": "text/tsx",
  ".jsx": "text/jsx", ".html": "text/html", ".css": "text/css",
  ".go": "text/x-go", ".rs": "text/x-rust",
};

export function getAttachmentFormat(filename: string): Pick<FileAttachment, "category" | "mimeType"> {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (imageMime[extension]) return { category: "image", mimeType: imageMime[extension] };
  const document = Object.entries(DOCUMENT_FORMATS).find(([suffix]) => suffix === extension)?.[1];
  if (document) return { category: "document", mimeType: document.mimeType };
  if ((TEXT_EXTENSIONS as readonly string[]).includes(extension.slice(1))) {
    return { category: "text", mimeType: textMime[extension] ?? "text/plain" };
  }
  return { category: "file", mimeType: extension === ".zip" ? "application/zip" : "application/octet-stream" };
}
