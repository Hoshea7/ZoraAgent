import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PencilIcon } from "lucide-react";
import type { ConversationMessage, FileAttachment } from "../../types";
import type { EditIntent } from "../../../shared/zora";
import { formatFileSize } from "../../utils/format";
import { AttachmentImageLightbox } from "./AttachmentImageLightbox";
import { CopyButton } from "./MarkdownMessage";

const USER_MESSAGE_SURFACE_CLASS =
  "rounded-[24px] rounded-tr-[8px] bg-[#f0e8dc] px-4 py-3 shadow-sm";

function formatMessageTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function MessageAttachments({ attachments }: { attachments: FileAttachment[] }) {
  const [previewImage, setPreviewImage] = useState<{
    alt: string;
    src: string;
  } | null>(null);

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
    <>
      {previewImage ? (
        <AttachmentImageLightbox
          alt={previewImage.alt}
          src={previewImage.src}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}

      <div className="flex w-full max-w-[250px] flex-col gap-1.5">
        {attachments.map((attachment) => {
          const hasImagePreview =
            attachment.category === "image" && Boolean(attachment.base64Data);
          const isImagePlaceholder =
            attachment.category === "image" && !attachment.base64Data;
          const imageSrc = hasImagePreview
            ? `data:image/jpeg;base64,${attachment.base64Data}`
            : null;
          const FileIcon = attachment.category === "image" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="8.5" cy="9" r="1.5" />
              <path d="m21 15-4.5-4.5L7 20" />
            </svg>
          ) : attachment.category === "document" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
              <path d="M14 2v5h5" />
              <path d="M9 13h6M9 17h4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
              <path d="M14 2v5h5" />
              <path d="M9 13h6M9 17h6M9 9h1" />
            </svg>
          );

          return (
            <div
              key={attachment.id}
              className="flex w-full items-center gap-2.5 rounded-[18px] bg-[#EBE4DC] p-1.5 pr-3 transition-all"
              title={attachment.name}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-white shadow-sm ring-1 ring-inset ring-black/5">
                {imageSrc ? (
                  <button
                    type="button"
                    className="h-full w-full cursor-zoom-in"
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
                  <div className="text-stone-400">
                    {FileIcon}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col justify-center">
                <div className="truncate text-sm font-medium leading-snug text-stone-900">
                  {truncateAttachmentName(attachment.name, 20)}
                </div>
                <div className="mt-0.5 text-xs leading-tight text-stone-500">
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
    </>
  );
}

export const UserMessage = memo(function UserMessage({
  message,
  canEdit = false,
  editIntent,
  isEditing = false,
  onStartEdit,
  onCancelEdit,
  onResend,
}: {
  message: ConversationMessage;
  canEdit?: boolean;
  editIntent?: EditIntent;
  isEditing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onResend?: (messageId: string, text: string) => Promise<void>;
}) {
  const [editedText, setEditedText] = useState(message.text ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    setEditedText(message.text ?? "");
    setSubmitError(null);
  }, [isEditing, message.id]);

  useLayoutEffect(() => {
    if (!isEditing || !editorRef.current) {
      return;
    }

    const editor = editorRef.current;
    editor.style.height = "0px";
    const nextHeight = Math.min(Math.max(editor.scrollHeight, 28), 144);
    editor.style.height = `${nextHeight}px`;
    editor.style.overflowY = editor.scrollHeight > 144 ? "auto" : "hidden";
  }, [editedText, isEditing]);

  const canResend = editedText.trim().length > 0 || Boolean(message.attachments?.length);
  const hasVisibleContent = Boolean(message.text || message.attachments?.length);
  const handleResend = async () => {
    if (!onResend || !canResend || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onResend(message.id, editedText);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "重新发送失败，请重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <article className="group ml-auto mt-6 flex w-full flex-col items-end gap-1">
      {message.correction ? (
        <span className="mr-2 text-xs font-medium text-stone-500">修正消息</span>
      ) : null}
      {message.attachments?.length ? (
        <MessageAttachments attachments={message.attachments} />
      ) : null}

      {isEditing ? (
        <div className={`w-full max-w-[640px] ${USER_MESSAGE_SURFACE_CLASS}`}>
          <textarea
            ref={editorRef}
            autoFocus
            aria-label="编辑消息"
            value={editedText}
            onChange={(event) => setEditedText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelEdit?.();
                return;
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleResend();
              }
            }}
            disabled={isSubmitting}
            rows={1}
            className="block min-h-7 w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-[1.66] text-[#332f2a] outline-none placeholder:text-stone-400"
          />
          <p className="mt-1.5 text-xs leading-5 text-stone-500">
            {editIntent === "correct_active_run"
              ? "修正会追加到当前运行，原消息和已有输出会保留。"
              : "编辑并重新运行会删除此后的会话记录；已执行的文件修改和外部操作不会撤销。"}
          </p>
          {submitError ? (
            <p role="alert" className="mt-1 text-xs leading-5 text-rose-600">
              {submitError}
            </p>
          ) : null}
          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={isSubmitting}
              className="h-8 rounded-full border border-stone-200 bg-white px-3 text-[13px] font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={!canResend || isSubmitting}
              className="h-8 rounded-full bg-stone-900 px-3 text-[13px] font-medium text-white transition-colors hover:bg-stone-800 disabled:bg-stone-300"
            >
              {isSubmitting ? "发送中" : "发送"}
            </button>
          </div>
        </div>
      ) : message.text ? (
        <div className={`max-w-[min(100%,640px)] transition-all ${USER_MESSAGE_SURFACE_CLASS}`}>
          <div className="chat-message-content whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {message.text}
          </div>
        </div>
      ) : null}

      {!isEditing && hasVisibleContent ? (
        <div
          data-user-message-actions="true"
          className="mr-0.5 flex h-7 items-center justify-end gap-0.5 text-stone-400 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        >
          <time
            dateTime={new Date(message.timestamp).toISOString()}
            className="mr-1 text-[13px] font-normal tabular-nums leading-none"
          >
            {formatMessageTime(message.timestamp)}
          </time>
          <div className="flex items-center gap-0">
            {message.text ? (
              <CopyButton
                content={message.text}
                className="h-7 w-6 rounded-none text-stone-400 hover:bg-transparent hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
              />
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={onStartEdit}
                aria-label={editIntent === "correct_active_run" ? "修正消息" : "修改消息"}
                title={editIntent === "correct_active_run" ? "修正消息" : "修改消息"}
                className="inline-flex h-7 w-6 items-center justify-center text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
              >
                <PencilIcon className="h-3 w-3" strokeWidth={1.8} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
});
