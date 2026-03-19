import type { ConversationMessage, FileAttachment } from "../../types";
import { formatFileSize } from "../../utils/format";

export function ZoraAvatar() {
  return (
    <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-orange-500 text-white shadow-sm">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: FileAttachment[] }) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const truncateAttachmentName = (name: string, maxLength = 18) => {
    if (name.length <= maxLength) return name;
    const extIdx = name.lastIndexOf(".");
    if (extIdx <= 0) return `${name.slice(0, maxLength - 3)}...`;
    const ext = name.slice(extIdx);
    const base = name.slice(0, extIdx);
    if (base.length + ext.length <= maxLength) return name;
    return `${base.slice(0, Math.max(0, maxLength - ext.length - 3))}...${ext}`;
  };

  return (
    <div className="flex flex-col gap-2 w-full max-w-[280px]">
      {attachments.map((attachment) => {
        const hasImagePreview =
          attachment.category === "image" && Boolean(attachment.base64Data);
        const isImagePlaceholder =
          attachment.category === "image" && !attachment.base64Data;
        const FileIcon = attachment.category === "image" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="8.5" cy="9" r="1.5" />
            <path d="m21 15-4.5-4.5L7 20" />
          </svg>
        ) : attachment.category === "document" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 2v5h5" />
            <path d="M9 13h6M9 17h4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 2v5h5" />
            <path d="M9 13h6M9 17h6M9 9h1" />
          </svg>
        );

        return (
          <div
            key={attachment.id}
            className="flex w-full items-center gap-3.5 rounded-2xl bg-[#EBE4DC] p-2 pr-4 transition-all"
            title={attachment.name}
          >
            <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-white shadow-sm ring-1 ring-inset ring-black/5">
              {hasImagePreview ? (
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.base64Data}`}
                  alt={attachment.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="text-stone-400">
                  {FileIcon}
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <div className="truncate text-[14px] font-medium leading-snug text-stone-900">
                {truncateAttachmentName(attachment.name, 22)}
              </div>
              <div className="mt-0.5 text-[12px] leading-tight text-stone-500">
                {isImagePlaceholder
                  ? `图片过大 • ${formatFileSize(attachment.size)}`
                  : `${attachment.category === "image"
                      ? "Image"
                      : attachment.category === "document"
                        ? "PDF"
                        : "Text"} • ${formatFileSize(attachment.size)}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UserMessage({ message }: { message: ConversationMessage }) {
  return (
    <article className="ml-auto mt-6 flex max-w-[85%] flex-col items-end gap-1">
      {message.attachments?.length ? (
        <MessageAttachments attachments={message.attachments} />
      ) : null}

      {message.text ? (
        <div className="rounded-[24px] rounded-tr-[8px] bg-[#f0e8dc] px-4 py-3 text-stone-900 shadow-sm transition-all max-w-full">
          <div className="whitespace-pre-wrap text-[15px] leading-[1.6] font-normal">
            {message.text}
          </div>
        </div>
      ) : null}
    </article>
  );
}
