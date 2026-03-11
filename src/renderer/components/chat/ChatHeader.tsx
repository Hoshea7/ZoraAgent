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
    <header className="flex items-center justify-between border-b border-stone-900/8 px-5 py-4 sm:px-6">
      <div>
        <div className="text-[0.68rem] uppercase tracking-[0.24em] text-stone-500">
          {currentSession ? "会话" : "Live Transcript"}
        </div>
        <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-stone-900">
          {currentSession?.title || "Claude Agent Session"}
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
        <span
          className={`inline-flex h-2.5 w-2.5 rounded-full ${
            isRunning ? "bg-amber-600" : "bg-emerald-600"
          }`}
        />
        {isRunning ? "Streaming" : "Idle"}
      </div>
    </header>
  );
}
