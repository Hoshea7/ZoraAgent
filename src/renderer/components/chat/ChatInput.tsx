import { useRef, useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { FileAttachment } from "../../types";
import {
  currentSessionRunSourceAtom,
  addDraftAttachmentsAtom,
  draftAtom,
  draftAttachmentsAtom,
  isRunningAtom,
  removeDraftAttachmentAtom,
} from "../../store/chat";
import { activeProviderAtom, providersAtom } from "../../store/provider";
import {
  currentSessionAtom,
  draftSelectedModelIdAtom,
} from "../../store/workspace";
import { isSettingsOpenAtom, settingsTabAtom } from "../../store/ui";
import { resolveCurrentProviderAndModel } from "../../utils/provider-selection";
import { Button } from "../ui/Button";
import { AttachmentPreview } from "./AttachmentPreview";
import { ModelSelector } from "./ModelSelector";
import { PermissionModeButton } from "./PermissionModeButton";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_DROP_MESSAGE =
  "当前仅支持图片（png/jpg/jpeg/gif/webp）、PDF，以及 txt/md/csv/json/xml/py/js/ts/tsx/jsx/html/css/go/rs 文件，且单个文件不超过 10 MB。";
const DROP_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".jsx": "text/jsx",
  ".html": "text/html",
  ".css": "text/css",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
};
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const SUPPORTED_PASTE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];

  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    );
  }

  return btoa(chunks.join(""));
}

function isFileTransfer(dataTransfer: DataTransfer): boolean {
  const transferTypes = Array.from(dataTransfer.types);

  return (
    dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.items).some((item) => item.kind === "file") ||
    transferTypes.includes("Files") ||
    transferTypes.includes("public.file-url")
  );
}

function getFileExtension(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return extension.startsWith(".") ? extension : "";
}

function getAttachmentCategoryFromMimeType(
  mimeType: string
): FileAttachment["category"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType === "application/pdf") {
    return "document";
  }

  return "text";
}

function resolveDroppedFilePath(file: File): string {
  const getPathForFile = (
    window.zora as typeof window.zora & {
      getPathForFile?: (file: File) => string;
    }
  ).getPathForFile;

  if (typeof getPathForFile !== "function") {
    const legacyPath = (file as File & { path?: string }).path;
    return typeof legacyPath === "string" ? legacyPath : "";
  }

  try {
    const resolvedPath = getPathForFile(file);

    if (resolvedPath) {
      return resolvedPath;
    }
  } catch (error) {
    console.warn("[chat-input] Failed to resolve dropped file path via webUtils.", error);
  }

  const legacyPath = (file as File & { path?: string }).path;
  return typeof legacyPath === "string" ? legacyPath : "";
}

async function buildAttachmentFromBrowserFile(
  file: File
): Promise<FileAttachment | null> {
  const extension = getFileExtension(file.name);
  const mimeType = DROP_MIME_MAP[extension];

  if (!mimeType || file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return null;
  }

  const category = getAttachmentCategoryFromMimeType(mimeType);
  const attachment: FileAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    category,
    mimeType,
    size: file.size,
    localPath: "",
  };

  if (category === "image") {
    attachment.base64Data = arrayBufferToBase64(await file.arrayBuffer());
  }

  return attachment;
}

export interface ChatInputProps {
  onSubmit: () => void;
  onStop: () => void;
}

export function ChatInput({ onSubmit, onStop }: ChatInputProps) {
  const [draft, setDraft] = useAtom(draftAtom);
  const isRunning = useAtomValue(isRunningAtom);
  const currentRunSource = useAtomValue(currentSessionRunSourceAtom);
  const attachments = useAtomValue(draftAttachmentsAtom);
  const activeProvider = useAtomValue(activeProviderAtom);
  const providers = useAtomValue(providersAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const addAttachments = useSetAtom(addDraftAttachmentsAtom);
  const removeAttachment = useSetAtom(removeDraftAttachmentAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const dropNoticeTimerRef = useRef<number | null>(null);
  const textareaScrollTimerRef = useRef<number | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isTextareaScrolling, setIsTextareaScrolling] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const hasAttachmentCapacity = attachments.length < MAX_ATTACHMENTS;
  const isFeishuRunning = isRunning && currentRunSource === "feishu";
  const hasEnabledProviders = enabledProviders.length > 0;
  const fallbackProvider = activeProvider ?? enabledProviders[0] ?? null;
  const {
    provider: resolvedProvider,
    modelId: resolvedModelId,
    isLocked,
    isMissingLockedProvider,
  } = resolveCurrentProviderAndModel(
    providers,
    currentSession,
    draftSelectedModelId
  );
  const displayProvider = resolvedProvider ?? fallbackProvider;
  const providerLabel = isMissingLockedProvider
    ? "此会话绑定的 Provider 已删除"
    : displayProvider
      ? `${displayProvider.name} · ${resolvedModelId ?? "默认模型"}`
      : "配置模型";
  const canSubmit =
    (draft.trim().length > 0 || attachments.length > 0) &&
    !isMissingLockedProvider;
  const shouldShowModelSelector =
    hasEnabledProviders || isLocked || isMissingLockedProvider;

  // Auto-resize textarea
  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`; // Max height around ~25vh
    }
  };

  useEffect(() => {
    handleInput();
  }, [draft]);

  useEffect(() => {
    return () => {
      if (dropNoticeTimerRef.current !== null) {
        window.clearTimeout(dropNoticeTimerRef.current);
      }

      if (textareaScrollTimerRef.current !== null) {
        window.clearTimeout(textareaScrollTimerRef.current);
      }
    };
  }, []);

  const showDropNotice = (message: string) => {
    if (dropNoticeTimerRef.current !== null) {
      window.clearTimeout(dropNoticeTimerRef.current);
    }

    setDropNotice(message);
    dropNoticeTimerRef.current = window.setTimeout(() => {
      setDropNotice(null);
      dropNoticeTimerRef.current = null;
    }, 3600);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isRunning && canSubmit) {
        onSubmit();
      } else if (isRunning) {
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2000);
      }
    }
  };

  const handleTextareaScroll = () => {
    setIsTextareaScrolling(true);

    if (textareaScrollTimerRef.current !== null) {
      window.clearTimeout(textareaScrollTimerRef.current);
    }

    textareaScrollTimerRef.current = window.setTimeout(() => {
      setIsTextareaScrolling(false);
      textareaScrollTimerRef.current = null;
    }, 720);
  };

  const handleSelectFiles = async () => {
    try {
      const files = await window.zora.selectFiles();

      if (files.length > 0) {
        addAttachments(files);
      }
    } catch (error) {
      console.error("[chat-input] Failed to select files.", error);
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;

    if (hasAttachmentCapacity) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = hasAttachmentCapacity ? "copy" : "none";

    if (hasAttachmentCapacity) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    dragDepthRef.current = 0;

    if (!hasAttachmentCapacity) {
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files).slice(
      0,
      MAX_ATTACHMENTS - attachments.length
    );

    if (droppedFiles.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        droppedFiles.map(async (file) => {
          const filePath = resolveDroppedFilePath(file);

          if (filePath) {
            const attachment = await window.zora.readFileAsAttachment(filePath);

            if (attachment) {
              return attachment;
            }
          }

          return buildAttachmentFromBrowserFile(file);
        })
      );
      const validAttachments = results.filter(
        (attachment): attachment is FileAttachment => attachment !== null
      );

      if (validAttachments.length > 0) {
        addAttachments(validAttachments);
      }

      if (validAttachments.length === droppedFiles.length) {
        setDropNotice(null);
        return;
      }

      if (validAttachments.length > 0) {
        showDropNotice(`部分文件已忽略。${SUPPORTED_DROP_MESSAGE}`);
        return;
      }

      showDropNotice(SUPPORTED_DROP_MESSAGE);
    } catch (error) {
      console.error("[chat-input] Failed to read dropped files.", error);
      showDropNotice(SUPPORTED_DROP_MESSAGE);
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!hasAttachmentCapacity) {
      return;
    }

    const imageItems = Array.from(event.clipboardData.items).filter(
      (item) =>
        item.type.startsWith("image/") &&
        SUPPORTED_PASTE_IMAGE_TYPES.has(item.type)
    );

    if (imageItems.length === 0) {
      return;
    }

    event.preventDefault();

    const pastedAttachments: FileAttachment[] = [];

    for (const [index, item] of imageItems
      .slice(0, MAX_ATTACHMENTS - attachments.length)
      .entries()) {
      const blob = item.getAsFile();

      if (!blob || blob.size > MAX_ATTACHMENT_SIZE_BYTES) {
        continue;
      }

      const mimeType = item.type || "image/png";
      const timestamp = Date.now() + index;

      pastedAttachments.push({
        id: crypto.randomUUID(),
        name: `paste-${timestamp}.png`,
        category: "image",
        mimeType,
        size: blob.size,
        localPath: "",
        base64Data: arrayBufferToBase64(await blob.arrayBuffer()),
      });
    }

    if (pastedAttachments.length > 0) {
      addAttachments(pastedAttachments);
    }
  };

  const openProviderSettings = () => {
    setSettingsTab("provider");
    setSettingsOpen(true);
  };

  return (
    <div className="relative">
      <div className="absolute -top-12 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none z-50">
        {showToast && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-stone-800 text-white text-xs px-3 py-1.5 rounded-md shadow-lg">
            先停止对话才能发送消息
          </div>
        )}
        {dropNotice && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-amber-50 text-amber-800 border border-amber-200 text-xs px-4 py-2 rounded-xl shadow-lg max-w-[90%] text-center leading-relaxed backdrop-blur-sm bg-amber-50/95">
            {dropNotice}
          </div>
        )}
      </div>

      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => {
          void handleDrop(event);
        }}
        className={`relative flex flex-col rounded-[24px] border border-stone-200 bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all focus-within:border-stone-300 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.06)] ${
          isDragging
            ? "border-sky-300 ring-2 ring-sky-400/35 shadow-[0_0_0_1px_rgba(125,211,252,0.16),0_10px_28px_rgba(14,165,233,0.10)]"
            : ""
        }`}
      >
        {isDragging ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[18px] border border-dashed border-sky-300 bg-sky-50/90 px-6 text-sky-700 backdrop-blur-[1px]">
            <div className="flex max-w-[30rem] flex-col items-center gap-1 text-center">
              <div className="text-[13px] font-semibold tracking-wide">
                拖放文件到这里
              </div>
              <div className="text-[11px] leading-relaxed text-sky-600">
                支持 png/jpg/jpeg/gif/webp、pdf、txt/md/csv/json/xml/py/js/ts/tsx/jsx/html/css/go/rs，单个文件不超过 10 MB
              </div>
            </div>
          </div>
        ) : null}

        <AttachmentPreview
          attachments={attachments}
          onRemove={removeAttachment}
        />

        <textarea
          ref={textareaRef}
          data-scrolling={isTextareaScrolling ? "true" : "false"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleTextareaScroll}
          onPaste={(event) => {
            void handlePaste(event);
          }}
          disabled={isFeishuRunning}
          placeholder={
            isFeishuRunning ? "飞书端运行中…" : "给 Zora 发消息… Enter 发送，Shift+Enter 换行"
          }
          className={`w-full resize-none border-0 bg-transparent px-2 py-1 text-[14.5px] leading-[1.62] outline-none placeholder:text-stone-400 input-scrollbar ${
            isFeishuRunning ? "cursor-not-allowed text-stone-400" : "text-stone-900"
          }`}
          rows={1}
          style={{ minHeight: "26px", maxHeight: "180px" }}
        />



        <div className="mt-2 flex items-end justify-between px-1 pb-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void handleSelectFiles();
              }}
              disabled={isFeishuRunning || attachments.length >= MAX_ATTACHMENTS}
              title={
                isFeishuRunning
                  ? "飞书端任务运行中"
                  : attachments.length >= MAX_ATTACHMENTS
                    ? "最多添加 5 个附件"
                    : "添加附件"
              }
              aria-label={
                isFeishuRunning
                  ? "飞书端任务运行中"
                  : attachments.length >= MAX_ATTACHMENTS
                    ? "附件数量已达上限"
                    : "添加附件"
              }
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-stone-500 transition-colors duration-200 cursor-pointer hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M21.44 11.05 12.25 20.24a6 6 0 1 1-8.49-8.49l9.2-9.19a4 4 0 1 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <PermissionModeButton />

            <div className="ml-1 h-4 w-px shrink-0 bg-stone-200" />

            {shouldShowModelSelector ? (
              <ModelSelector
                trigger={
                  <button
                    type="button"
                    className={`inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:ring-offset-1 ${
                      isMissingLockedProvider
                        ? "text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                        : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                    }`}
                    aria-label="切换当前模型渠道"
                  >
                    {isLocked && !isMissingLockedProvider ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      >
                        <rect x="6" y="11" width="12" height="9" rx="2" />
                        <path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" />
                      </svg>
                    ) : null}
                    <span className="truncate">{providerLabel}</span>
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5 shrink-0"
                    >
                      <path d="m5 7 5 6 5-6" />
                    </svg>
                  </button>
                }
              />
            ) : (
              <button
                type="button"
                onClick={openProviderSettings}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-stone-500 transition-colors duration-200 hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:ring-offset-1"
                aria-label="打开模型配置"
              >
                <span>{providerLabel}</span>
                <span aria-hidden="true">⚙</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="primary"
                onClick={onStop}
                className="w-8 h-8 p-0 rounded-full shadow-sm !bg-stone-800 hover:!bg-stone-900 focus:!ring-stone-400 flex items-center justify-center cursor-pointer"
                title="停止"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="w-8 h-8 p-0 rounded-full shadow-sm flex items-center justify-center cursor-pointer"
                title={
                  isMissingLockedProvider
                    ? "此会话绑定的 Provider 已被删除，请创建新会话"
                    : "发送"
                }
              >
                <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
