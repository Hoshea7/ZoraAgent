import { useAtom, useSetAtom } from "jotai";
import { sidebarCollapsedAtom } from "../../store/ui";
import { startNewChatAtom } from "../../store/workspace";
import { messagesAtom } from "../../store/chat";
import { cn } from "../../utils/cn";
import { SessionList } from "../sidebar/SessionList";
import { SidebarFooter } from "../sidebar/SidebarFooter";

export function LeftSidebar() {
  const [collapsed] = useAtom(sidebarCollapsedAtom);
  const startNewChat = useSetAtom(startNewChatAtom);
  const setMessages = useSetAtom(messagesAtom);

  const handleNewChat = () => {
    startNewChat();
    setMessages([]);
  };

  return (
    <aside
      className={cn(
        "titlebar-no-drag flex h-full flex-col overflow-hidden bg-[#f5f3f0] shadow-[2px_0_8px_rgba(0,0,0,0.04)] transition-all duration-300",
        collapsed ? "w-12" : "w-[260px]"
      )}
    >
      {!collapsed && (
        <>
          {/* 顶部项目信息 */}
          <div className="border-b border-stone-200/50 px-4 py-3 pt-[62px]">
            <div className="flex items-center gap-2 text-stone-600">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="text-sm font-medium text-stone-900">zora</span>
            </div>
            <div className="mt-1 text-xs text-stone-500 truncate">/Users/bytedance/Desktop/code...</div>
          </div>

          {/* SESSIONS 标题和新建按钮 */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Sessions</h2>
            <button
              onClick={handleNewChat}
              className="rounded-full p-1.5 border border-blue-500 text-blue-500 hover:bg-blue-50 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* 会话列表区域 */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <SessionList />
          </div>

          {/* 底部区域 */}
          <div className="border-t border-stone-200/50 p-3">
            <SidebarFooter />
          </div>
        </>
      )}

      {collapsed && (
        <div className="flex h-full flex-col items-center py-4">
          {/* 折叠状态下的图标 */}
          <button className="rounded-lg p-2 hover:bg-stone-100">
            <svg
              className="h-5 w-5 text-stone-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}
