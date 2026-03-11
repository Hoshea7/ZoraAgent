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
    createSession("新会话");
  };

  const handleSwitchSession = (sessionId: string) => {
    switchSession(sessionId);
  };

  const renderSession = (session: Session) => (
    <button
      key={session.id}
      onClick={() => handleSwitchSession(session.id)}
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition",
        currentSessionId === session.id
          ? "bg-stone-100"
          : "hover:bg-stone-50"
      )}
    >
      <div className="flex h-5 w-5 items-center justify-center">
        <div className={cn(
          "h-2 w-2 rounded-full border-2",
          currentSessionId === session.id
            ? "border-stone-400"
            : "border-stone-300"
        )}></div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-stone-900 truncate">{session.title}</div>
        <div className="text-xs text-stone-500">
          {new Date(session.createdAt).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>
      </div>
      {currentSessionId !== session.id && (
        <button className="opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="h-4 w-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
        </button>
      )}
    </button>
  );

  return (
    <div className="space-y-1">
      {/* 置顶会话 */}
      {groupedSessions.pinned.length > 0 && (
        <div className="space-y-1">
          {groupedSessions.pinned.map(renderSession)}
        </div>
      )}

      {/* 今天的会话 */}
      {groupedSessions.today.length > 0 && (
        <div className="space-y-1">
          {groupedSessions.today.map(renderSession)}
        </div>
      )}

      {/* 更早的会话 */}
      {groupedSessions.earlier.length > 0 && (
        <div className="space-y-1">
          {groupedSessions.earlier.map(renderSession)}
        </div>
      )}
    </div>
  );
}
