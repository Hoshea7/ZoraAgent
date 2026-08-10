import { useEffect } from "react";

interface SubtaskArchiveDialogProps {
  title: string;
  onCancel: () => void;
  onArchiveFamily: () => void;
  onArchiveSubtask: () => void;
}

export function SubtaskArchiveDialog({
  title,
  onCancel,
  onArchiveFamily,
  onArchiveSubtask,
}: SubtaskArchiveDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-stone-900/24 px-4 backdrop-blur-[1px]"
      role="presentation"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="subtask-archive-title"
        className="w-full max-w-[390px] rounded-2xl border border-stone-200 bg-[#fffdf9] p-5 shadow-[0_24px_60px_rgba(35,31,27,0.22)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          id="subtask-archive-title"
          className="text-[16px] font-semibold text-stone-950"
        >
          归档子任务？
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-stone-600">
          {title}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-stone-500">
          可以只归档当前子任务，也可以归档父会话及其全部子任务。恢复时会按本次归档范围恢复。
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-lg border border-stone-200 bg-white px-3 text-[12px] font-medium text-stone-700 transition hover:bg-stone-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onArchiveSubtask}
            className="h-8 rounded-lg border border-stone-300 bg-white px-3 text-[12px] font-medium text-stone-800 transition hover:bg-stone-50"
          >
            仅归档此子任务
          </button>
          <button
            type="button"
            onClick={onArchiveFamily}
            className="h-8 rounded-lg bg-stone-950 px-3 text-[12px] font-medium text-white transition hover:bg-stone-800"
          >
            全部归档
          </button>
        </div>
      </div>
    </div>
  );
}
