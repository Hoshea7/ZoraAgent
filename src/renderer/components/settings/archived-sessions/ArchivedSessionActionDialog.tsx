import { useEffect } from "react";
import type { ArchivedSessionEntry } from "../../../../shared/zora";
import { DEFAULT_WORKSPACE_ID } from "../../../store/workspace";
import { cn } from "../../../utils/cn";
import { getArchivedSessionKey } from "./archived-session-utils";

interface ArchivedSessionActionDialogProps {
  action: "restore" | "delete";
  entries: ArchivedSessionEntry[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ArchivedSessionActionDialog({
  action,
  entries,
  busy,
  onCancel,
  onConfirm,
}: ArchivedSessionActionDialogProps) {
  const isDelete = action === "delete";
  const isSingle = entries.length === 1;
  const hasDefaultWorkspace = entries.some(
    (entry) => entry.workspaceId === DEFAULT_WORKSPACE_ID
  );
  const hasProjectWorkspace = entries.some(
    (entry) => entry.workspaceId !== DEFAULT_WORKSPACE_ID
  );
  const previewEntries = entries.slice(0, 3);
  const remainingCount = entries.length - previewEntries.length;
  const title = isDelete
    ? isSingle
      ? "永久删除归档会话？"
      : `永久删除 ${entries.length} 条归档会话？`
    : isSingle
      ? "恢复归档会话？"
      : `恢复 ${entries.length} 条归档会话？`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-stone-900/24 px-4 backdrop-blur-[1px]"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="archived-session-action-title"
        className="w-full max-w-[390px] rounded-2xl border border-stone-200 bg-[#fffdf9] p-5 shadow-[0_24px_60px_rgba(35,31,27,0.22)]"
      >
        <div
          id="archived-session-action-title"
          className="text-[16px] font-semibold text-stone-950"
        >
          {title}
        </div>
        {isDelete ? (
          <div className="mt-3 rounded-xl bg-stone-50 px-3 py-2">
            <div className="text-[11px] font-medium text-stone-400">
              {isSingle ? "会话" : "已选择会话"}
            </div>
            {isSingle ? (
              <div className="mt-1 line-clamp-2 text-[13px] font-medium leading-relaxed text-stone-900">
                {entries[0].session.title}
              </div>
            ) : (
              <div className="mt-1 space-y-1">
                {previewEntries.map((entry) => (
                  <div
                    key={getArchivedSessionKey(entry)}
                    className="truncate text-[13px] font-medium leading-relaxed text-stone-900"
                  >
                    {entry.session.title}
                  </div>
                ))}
                {remainingCount > 0 ? (
                  <div className="text-[12px] text-stone-500">
                    还有 {remainingCount} 条
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        <div className="mt-4 space-y-2 text-[13px] leading-relaxed">
          {isDelete ? (
            <>
              <div>
                <div className="font-medium text-stone-900">将删除</div>
                <div className="mt-0.5 text-stone-500">
                  {hasDefaultWorkspace && hasProjectWorkspace
                    ? "会话记录、附件，以及默认区会话生成的默认区文件。"
                    : hasDefaultWorkspace
                      ? "会话记录、附件和这条会话生成的默认区文件。"
                      : "会话记录和附件。"}
                </div>
              </div>
              {hasProjectWorkspace ? (
                <div>
                  <div className="font-medium text-stone-900">不会删除</div>
                  <div className="mt-0.5 text-stone-500">项目目录或项目文件。</div>
                </div>
              ) : null}
              <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-700 ring-1 ring-red-100">
                删除后无法恢复。
              </div>
            </>
          ) : (
            <div>
              <div className="font-medium text-stone-900">将恢复</div>
              <div className="mt-0.5 text-stone-500">
                会话会回到对应工作区的会话列表，并从已归档会话中移除。
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-8 rounded-lg border border-stone-200 bg-white px-3 text-[12px] font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn(
              "h-8 rounded-lg px-3 text-[12px] font-medium transition disabled:cursor-not-allowed",
              isDelete
                ? "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300"
                : "bg-stone-950 text-white hover:bg-stone-800 disabled:bg-stone-300"
            )}
          >
            {busy
              ? isDelete
                ? "删除中"
                : "恢复中"
              : isDelete
                ? "永久删除"
                : "确认恢复"}
          </button>
        </div>
      </div>
    </div>
  );
}
