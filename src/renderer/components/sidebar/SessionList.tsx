import { useAtom, useSetAtom } from "jotai";
import {
  groupedSessionsAtom,
  currentSessionIdAtom,
  createSessionAtom,
  switchSessionAtom
} from "../../store/workspace";
import { cn } from "../../utils/cn";
import type { Session } from "../../types";

/**
 * 会话列表组件
 * 显示按时间分组的会话列表和新建按钮
 */
export function SessionList() {
  const [groupedSessions] = useAtom(groupedSessionsAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const switchSession = useSetAtom(switchSessionAtom);

  const handleCreateSession = () => {
    createSession("新 Agent 会话");
  };

  const handleSwitchSession = (sessionId: string) => {
    switchSession(sessionId);
  };

  const renderSession = (session: Session) => (
    <button
      key={session.id}
      onClick={() => handleSwitchSession(session.id)}
      className={cn(
        "flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] transition",
        currentSessionId === session.id
          ? "bg-stone-900/[0.08] shadow-sm"
          : "hover:bg-stone-900/[0.04]"
      )}
    >
      <span className="flex-1 truncate">{session.title}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* 新建会话按钮 */}
      <button
        onClick={handleCreateSession}
        className="flex w-full items-center gap-3 rounded-[10px] bg-stone-900/[0.04] px-3 py-2 text-left text-[13px] transition hover:bg-stone-900/[0.08]"
      >
        <svg
          className="h-4 w-4 text-stone-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        <span>新会话</span>
      </button>

      {/* 置顶会话 */}
      {groupedSessions.pinned.length > 0 && (
        <div className="space-y-1">
          <div className="px-3 text-xs font-medium uppercase tracking-wider text-stone-500">
            置顶会话
          </div>
          {groupedSessions.pinned.map(renderSession)}
        </div>
      )}

      {/* 今天的会话 */}
      {groupedSessions.today.length > 0 && (
        <div className="space-y-1">
          <div className="px-3 text-xs font-medium uppercase tracking-wider text-stone-500">
            今天
          </div>
          {groupedSessions.today.map(renderSession)}
        </div>
      )}

      {/* 更早的会话 */}
      {groupedSessions.earlier.length > 0 && (
        <div className="space-y-1">
          <div className="px-3 text-xs font-medium uppercase tracking-wider text-stone-500">
            更早
          </div>
          {groupedSessions.earlier.map(renderSession)}
        </div>
      )}
    </div>
  );
}
