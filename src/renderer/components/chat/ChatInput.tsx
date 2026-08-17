import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
import {
  providersAtom,
  providersLoadedAtom,
} from "../../store/provider";
import {
  currentSessionAtom,
  currentWorkspaceIdAtom,
  draftSelectedProviderIdAtom,
  draftSelectedModelIdAtom,
} from "../../store/workspace";
import {
  defaultModelSettingsAtom,
  loadDefaultModelSettingsAtom,
} from "../../store/default-model";
import { openSettingsAtom, settingsTabAtom } from "../../store/ui";
import { resolveCurrentProviderAndModel } from "../../utils/provider-selection";
import { Button } from "../ui/Button";
import { AttachmentPreview } from "./AttachmentPreview";
import { PermissionModeButton } from "./PermissionModeButton";
import { ContextWindowBadge } from "./ContextWindowBadge";
import { AgentSettingsSelector } from "./AgentSettingsSelector";
import { RuntimeSelector } from "./RuntimeSelector";
import { TransientChatNotice } from "./TransientChatNotice";
import { DOCUMENT_FORMATS } from "../../../shared/document-formats";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_DROP_MESSAGE =
  "当前仅支持图片（png/jpg/jpeg/gif/webp）、PDF、DOCX、XLSX、PPTX，以及 txt/md/csv/json/xml/py/js/ts/tsx/jsx/html/css/go/rs 文件，且单个文件不超过 10 MB。";
const DROP_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ...Object.fromEntries(
    Object.entries(DOCUMENT_FORMATS).map(([extension, entry]) => [
      extension,
      entry.mimeType,
    ])
  ),
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
const DOCUMENT_MIME_TYPES = new Set<string>(
  Object.values(DOCUMENT_FORMATS).map((entry) => entry.mimeType)
);
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

  if (DOCUMENT_MIME_TYPES.has(mimeType)) {
    return "document";
  }

  return "text";
}

function resolveDroppedFilePath(file: File): string {
  try {
    return window.zora.getPathForFile(file);
  } catch (error) {
    console.warn("[chat-input] Failed to resolve dropped file path via webUtils.", error);
    return "";
  }
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
    localPath: resolveDroppedFilePath(file),
  };

  if (!attachment.localPath && category !== "image") {
    return null;
  }

  if (category === "image") {
    attachment.base64Data = arrayBufferToBase64(await file.arrayBuffer());
  }

  return attachment;
}

export interface ChatInputProps {
  onSubmit: () => void;
  onQueueMessage: () => void;
  onStop: () => Promise<void>;
  variant?: "default" | "hero";
}

export function ChatInput({
  onSubmit,
  onQueueMessage,
  onStop,
  variant = "default",
}: ChatInputProps) {
  const [draft, setDraft] = useAtom(draftAtom);
  const isRunning = useAtomValue(isRunningAtom);
  const currentRunSource = useAtomValue(currentSessionRunSourceAtom);
  const attachments = useAtomValue(draftAttachmentsAtom);
  const providers = useAtomValue(providersAtom);
  const providersLoaded = useAtomValue(providersLoadedAtom);
  const defaultModelSettings = useAtomValue(defaultModelSettingsAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const draftSelectedProviderId = useAtomValue(draftSelectedProviderIdAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const loadDefaultModelSettings = useSetAtom(loadDefaultModelSettingsAtom);
  const addAttachments = useSetAtom(addDraftAttachmentsAtom);
  const removeAttachment = useSetAtom(removeDraftAttachmentAtom);
  const openSettings = useSetAtom(openSettingsAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const dropNoticeTimerRef = useRef<number | null>(null);
  const chatNoticeTimerRef = useRef<number | null>(null);
  const textareaScrollTimerRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isTextareaScrolling, setIsTextareaScrolling] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [isModelConfigDialogOpen, setIsModelConfigDialogOpen] = useState(false);
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const hasAttachmentCapacity = attachments.length < MAX_ATTACHMENTS;
  const isFeishuRunning = isRunning && currentRunSource === "feishu";
  const hasEnabledProviders = enabledProviders.length > 0;
  const { isMissingLockedProvider } = resolveCurrentProviderAndModel(
    providers,
    currentSession,
    defaultModelSettings,
    draftSelectedProviderId,
    draftSelectedModelId
  );
  const hasPromptContent = draft.trim().length > 0 || attachments.length > 0;
  const requiresModelConfig =
    providersLoaded && !isMissingLockedProvider && !hasEnabledProviders;
  const canSubmit =
    hasPromptContent &&
    !isMissingLockedProvider &&
    providersLoaded &&
    !requiresModelConfig;
  const canQueueMessage =
    hasPromptContent && !isMissingLockedProvider && !isFeishuRunning;
  const showQueueButton = isRunning && canQueueMessage;
  const sendButtonTitle = isRunning
    ? "发送追加消息"
    : isMissingLockedProvider
      ? "此会话绑定的 Provider 已被删除，请创建新会话"
      : requiresModelConfig
        ? "请先配置模型"
        : !providersLoaded
          ? "正在加载模型配置"
          : "发送";
  const isHeroVariant = variant === "hero";
  const inputShellClass = isHeroVariant
    ? "relative flex flex-col rounded-[22px] border border-stone-200/80 bg-white px-4 py-3 shadow-[0_16px_42px_rgba(41,37,36,0.07),0_2px_10px_rgba(41,37,36,0.035)] transition-all focus-within:border-stone-300 focus-within:shadow-[0_18px_48px_rgba(41,37,36,0.09),0_2px_10px_rgba(41,37,36,0.04)]"
    : "relative flex flex-col rounded-[24px] border border-stone-200 bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all focus-within:border-stone-300 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.06)]";
  const draggingClass =
    "border-sky-300 ring-2 ring-sky-400/35 shadow-[0_0_0_1px_rgba(125,211,252,0.16),0_10px_28px_rgba(14,165,233,0.10)]";

  // Auto-resize textarea
  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`; // Max height around ~25vh
    }
  };

  useEffect(() => {
    void loadDefaultModelSettings().catch((error) => {
      console.warn("[chat-input] Failed to load default model settings.", error);
    });
  }, [loadDefaultModelSettings]);

  useEffect(() => {
    handleInput();
  }, [draft]);

  useEffect(() => {
    return () => {
      if (dropNoticeTimerRef.current !== null) {
        window.clearTimeout(dropNoticeTimerRef.current);
      }
      if (chatNoticeTimerRef.current !== null) {
        window.clearTimeout(chatNoticeTimerRef.current);
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

  const showChatNotice = (message: string) => {
    if (chatNoticeTimerRef.current !== null) {
      window.clearTimeout(chatNoticeTimerRef.current);
    }
    setChatNotice(message);
    chatNoticeTimerRef.current = window.setTimeout(() => {
      setChatNotice(null);
      chatNoticeTimerRef.current = null;
    }, 3_000);
  };

  const handleStop = async () => {
    try {
      await onStop();
      showChatNotice("会话已停止");
    } catch {
      // MainArea presents the stop failure on the active turn.
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isRunning && hasPromptContent && requiresModelConfig) {
        setIsModelConfigDialogOpen(true);
        return;
      }
      if (!isRunning && canSubmit) {
        onSubmit();
      } else if (isRunning && canQueueMessage) {
        onQueueMessage();
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
    setIsModelConfigDialogOpen(false);
    setSettingsTab("provider");
    openSettings();
  };

  const handlePrimaryAction = () => {
    if (!isRunning && hasPromptContent && requiresModelConfig) {
      setIsModelConfigDialogOpen(true);
      return;
    }

    if (isRunning) {
      onQueueMessage();
      return;
    }

    onSubmit();
  };

  useEffect(() => {
    if (!isModelConfigDialogOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsModelConfigDialogOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isModelConfigDialogOpen]);

  const modelConfigDialog =
    isModelConfigDialogOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[160] flex items-center justify-center bg-stone-950/18 p-4 backdrop-blur-[2px]"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsModelConfigDialogOpen(false);
              }
            }}
          >
            <div
              className="w-full max-w-[360px] rounded-[22px] bg-white px-6 py-5 text-left shadow-2xl shadow-stone-950/18 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
              role="dialog"
              aria-modal="true"
              aria-labelledby="model-config-required-title"
            >
              <h3
                id="model-config-required-title"
                className="text-[17px] font-semibold tracking-tight text-stone-900"
              >
                当前未配置模型
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-stone-500">
                请先添加一个可用模型，配置完成后就可以继续发送消息。
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsModelConfigDialogOpen(false)}
                  className="h-9 px-4 text-[13px]"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={openProviderSettings}
                  className="h-9 px-4 text-[13px]"
                >
                  配置模型
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative">
      <div className="absolute -top-12 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none z-50">
        {dropNotice && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-amber-50 text-amber-800 border border-amber-200 text-xs px-4 py-2 rounded-xl shadow-lg max-w-[90%] text-center leading-relaxed backdrop-blur-sm bg-amber-50/95">
            {dropNotice}
          </div>
        )}
        {chatNotice && <TransientChatNotice message={chatNotice} />}
      </div>

      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => {
          void handleDrop(event);
        }}
        className={`${inputShellClass} ${isDragging ? draggingClass : ""}`}
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
          className={`w-full resize-none border-0 bg-transparent outline-none placeholder:text-stone-400 input-scrollbar ${
            isHeroVariant
              ? "px-1 py-0.5 text-[15px] leading-[1.55]"
              : "px-2 py-1 text-[14.5px] leading-[1.62]"
          } ${
            isFeishuRunning ? "cursor-not-allowed text-stone-400" : "text-stone-900"
          }`}
          rows={1}
          style={{ minHeight: "26px", maxHeight: "180px" }}
        />



        <div
          className={`flex items-end justify-between ${
            isHeroVariant ? "mt-3 px-0.5 pb-0" : "mt-2 px-1 pb-0.5"
          }`}
        >
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
            <ContextWindowBadge
              state={currentSession?.contextWindowState}
              canCompact={Boolean(
                currentSession && (currentSession.agentRuntimeType ?? "pi") === "pi"
              )}
              isRunning={isRunning}
              onCompact={
                currentSession
                  ? async () => {
                      const result = await window.zora.compactSession(
                        currentSession.id,
                        currentWorkspaceId
                      );
                      if (result.status === "not_needed") {
                        showChatNotice(result.message);
                      } else {
                        showChatNotice("上下文压缩完成");
                      }
                    }
                  : undefined
              }
            />
          </div>

          <div className="ml-3 flex min-w-0 shrink items-center gap-1.5">
            <AgentSettingsSelector
              onOpenProviderSettings={openProviderSettings}
            />
            <RuntimeSelector />

            {isRunning && !showQueueButton ? (
              <Button
                variant="primary"
                onClick={() => void handleStop()}
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
                onClick={handlePrimaryAction}
                disabled={
                  isRunning
                    ? !canQueueMessage
                    : !hasPromptContent || isMissingLockedProvider || !providersLoaded
                }
                className="w-8 h-8 p-0 rounded-full shadow-sm flex items-center justify-center cursor-pointer"
                title={sendButtonTitle}
              >
                <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </Button>
            )}
          </div>
        </div>
      </div>

      {modelConfigDialog}
    </div>
  );
}
