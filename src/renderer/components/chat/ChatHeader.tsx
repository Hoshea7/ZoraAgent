import { useAtom } from "jotai";
import { isRunningAtom } from "../../store/chat";
import { currentSessionAtom } from "../../store/workspace";

/**
 * 聊天标题栏组件
 * 显示当前会话标题和运行状态
 * 高度设定为 50px，与 macOS 红绿灯窗口控制按钮水平对齐
 */
export function ChatHeader() {
  const [isRunning] = useAtom(isRunningAtom);
  const [currentSession] = useAtom(currentSessionAtom);

  return (
    <header className="titlebar-drag-region flex h-[50px] shrink-0 items-center justify-center bg-white/95 px-6 relative z-10">
      <h1 className="titlebar-no-drag text-[14px] font-medium tracking-tight text-stone-700 cursor-default">
        {currentSession?.title || "新对话"}
      </h1>
      {isRunning && (
        <div className="absolute right-6 flex items-center gap-2" title="Agent is working...">
          <div className="h-2 w-2 animate-pulse rounded-full bg-orange-500 ring-4 ring-orange-500/20"></div>
        </div>
      )}
    </header>
  );
}
