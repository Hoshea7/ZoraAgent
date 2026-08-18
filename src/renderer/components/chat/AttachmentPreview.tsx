import { useState } from "react";
import type { FileAttachment } from "../../types";
import { formatFileSize } from "../../utils/format";
import { AttachmentImageLightbox } from "./AttachmentImageLightbox";

export interface AttachmentPreviewProps {
  attachments: FileAttachment[];
  onRemove: (id: string) => void;
}

function truncateFileName(name: string, maxLength = 20): string {
  if (name.length <= maxLength) {
    return name;
  }

  const extension = name.slice(name.lastIndexOf("."));
  const nameWithoutExt = name.slice(0, name.lastIndexOf("."));

  if (nameWithoutExt.length + extension.length <= maxLength) {
    return name;
  }

  return `${nameWithoutExt.slice(0, Math.max(0, maxLength - extension.length - 3))}...${extension}`;
}

function RemoveButton({
  attachmentName,
  onClick,
}: {
  attachmentName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`移除附件 ${attachmentName}`}
      className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 opacity-0 shadow-sm transition-all duration-200 hover:border-stone-300 hover:bg-stone-100 hover:text-stone-700 hover:scale-105 active:scale-95 group-hover:opacity-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
        <path d="M4 4l8 8M12 4 4 12" />
      </svg>
    </button>
  );
}

export function AttachmentPreview({
  attachments,
  onRemove,
}: AttachmentPreviewProps) {
  const [previewImage, setPreviewImage] = useState<{
    alt: string;
    src: string;
  } | null>(null);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      {previewImage ? (
        <AttachmentImageLightbox
          alt={previewImage.alt}
          src={previewImage.src}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}

      <div className="flex flex-wrap gap-2 px-2 pb-2.5 pt-1.5">
        {attachments.map((attachment) => {
          const imageSrc =
            attachment.category === "image" && attachment.base64Data
              ? `data:image/jpeg;base64,${attachment.base64Data}`
              : null;

          return (
            <div
              key={attachment.id}
              className="group relative flex h-12 max-w-[162px] shrink-0 items-center gap-2 rounded-[16px] border border-stone-200 bg-stone-50 pl-1.5 pr-2.5 shadow-sm transition-colors hover:border-stone-300"
              title={attachment.name}
            >
              {imageSrc ? (
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-white shadow-sm ring-1 ring-inset ring-stone-200/50 transition-transform hover:scale-[1.03]"
                  onClick={() =>
                    setPreviewImage({
                      alt: attachment.name,
                      src: imageSrc,
                    })
                  }
                  title={`查看图片 ${attachment.name}`}
                >
                  <img
                    src={imageSrc}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                  />
                </button>
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-white text-stone-500 shadow-sm ring-1 ring-inset ring-stone-200/50">
                  {attachment.category === "document" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                      <path d="M14 2v5h5" />
                      <path d="M9 13h6M9 17h4" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                      <path d="M14 2v5h5" />
                      <path d="M9 13h6M9 17h6M9 9h1" />
                    </svg>
                  )}
                </div>
              )}

              <div className="flex min-w-0 flex-col justify-center">
                <div className="truncate text-[12px] font-medium leading-tight text-stone-700">
                  {truncateFileName(attachment.name, 16)}
                </div>
                <div className="mt-0.5 truncate text-[10px] leading-tight text-stone-400">
                  {formatFileSize(attachment.size)}
                </div>
              </div>

              <RemoveButton
                attachmentName={attachment.name}
                onClick={() => onRemove(attachment.id)}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
