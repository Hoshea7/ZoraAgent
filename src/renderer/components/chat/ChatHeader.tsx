import { useAtom } from "jotai";
import { isRunningAtom } from "../../store/chat";
import { fileTreeVisibleAtom } from "../../store/filetree";
import { currentSessionAtom } from "../../store/workspace";
import { cn } from "../../utils/cn";

/**
 * 聊天标题栏组件
 * 显示当前会话标题和运行状态
 * 高度设定为 50px，与 macOS 红绿灯窗口控制按钮水平对齐
 */
export function ChatHeader() {
  const [isRunning] = useAtom(isRunningAtom);
  const [currentSession] = useAtom(currentSessionAtom);
  const [fileTreeVisible, setFileTreeVisible] = useAtom(fileTreeVisibleAtom);

  return (
    <header className="titlebar-drag-region relative z-10 flex h-[50px] shrink-0 items-center justify-center bg-white/95 px-6">
      <h1 className="titlebar-no-drag cursor-default text-[14px] font-medium tracking-tight text-stone-700">
        {currentSession?.title || "新对话"}
      </h1>
      <div className="absolute right-6 flex items-center gap-2">
        <button
          type="button"
          className={cn(
            "titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200",
            fileTreeVisible
              ? "bg-stone-100 text-stone-700 shadow-sm"
              : "text-stone-400 hover:bg-stone-50 hover:text-stone-600"
          )}
          onClick={() => setFileTreeVisible((current) => !current)}
          title="文件树"
          aria-pressed={fileTreeVisible}
        >
          <svg
            className="h-[17px] w-[17px]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="4" width="16" height="16" rx="2.5" />
            <path d="M14 4v16" />
            <path d="M7.5 8.5h3" />
            <path d="M7.5 11.5h2.5" />
            <path d="M7.5 14.5h2" />
          </svg>
        </button>

        {isRunning && (
          <div className="flex items-center gap-2" title="正在工作中…">
            <div className="h-2 w-2 animate-pulse rounded-full bg-orange-500 ring-4 ring-orange-500/20" />
          </div>
        )}
      </div>
    </header>
  );
}
