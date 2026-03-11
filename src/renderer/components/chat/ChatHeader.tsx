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
    <header className="flex items-center justify-center bg-white px-6 py-3 relative">
      <h1 className="text-base font-medium text-stone-900">
        {currentSession?.title || "新对话"}
      </h1>
      {isRunning && (
        <div className="absolute right-6 flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
        </div>
      )}
    </header>
  );
}
