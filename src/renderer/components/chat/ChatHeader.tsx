import { useAtom } from "jotai";
import { isRunningAtom } from "../../store/chat";
import { currentSessionAtom } from "../../store/workspace";

/**
 * 聊天标题栏组件
 * 显示当前会话标题和运行状态
 */
export function ChatHeader() {
  const [isRunning] = useAtom(isRunningAtom);
  const [currentSession] = useAtom(currentSessionAtom);

  return (
    <header className="flex h-[56px] items-center justify-center bg-white/95 px-6 relative z-10 backdrop-blur-sm border-b border-stone-100">
      <h1 className="text-[15px] font-semibold tracking-tight text-stone-800">
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
