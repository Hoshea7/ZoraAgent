import { useAtom, useSetAtom } from "jotai";
import { useState, useRef, useEffect } from "react";
import { sidebarCollapsedAtom } from "../../store/ui";
import { 
  startNewChatAtom, 
  workspacesAtom, 
  currentWorkspaceAtom,
  currentWorkspaceIdAtom
} from "../../store/workspace";
import { messagesAtom } from "../../store/chat";
import { cn } from "../../utils/cn";
import { SessionList } from "../sidebar/SessionList";
import { SidebarFooter } from "../sidebar/SidebarFooter";

export function LeftSidebar() {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const startNewChat = useSetAtom(startNewChatAtom);
  const setMessages = useSetAtom(messagesAtom);
  
  const [workspaces] = useAtom(workspacesAtom);
  const [currentWorkspace] = useAtom(currentWorkspaceAtom);
  const setCurrentWorkspaceId = useSetAtom(currentWorkspaceIdAtom);
  
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleNewChat = () => {
    startNewChat();
    setMessages([]);
  };

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    if (isWorkspaceMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isWorkspaceMenuOpen]);

  return (
    <aside
      className={cn(
        "titlebar-no-drag flex h-full flex-col overflow-hidden bg-[#f5f3f0] shadow-[2px_0_8px_rgba(0,0,0,0.04)] transition-all duration-300 relative",
        collapsed ? "w-12" : "w-[260px]"
      )}
    >
      {!collapsed && (
        <>
          <div className="border-b border-stone-200/50 px-4 py-3 pt-[62px] flex items-start justify-between relative">
            <div 
              className="flex-1 overflow-hidden cursor-pointer rounded-md hover:bg-stone-200/40 p-1 -ml-1 transition-colors select-none"
              onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
            >
              <div className="flex items-center justify-between gap-2 text-stone-600 pr-1">
                <div className="flex items-center gap-2 overflow-hidden">
                  <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="text-sm font-medium text-stone-900 truncate">
                    {currentWorkspace?.name || "未知工作区"}
                  </span>
                </div>
                <svg className="h-3.5 w-3.5 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <div 
                className="mt-1 text-[11px] text-stone-500 truncate pl-6" 
                title="/Users/bytedance/Desktop/code/learn/0311-zora"
              >
                /Users/bytedance/Desktop/code/learn/0311-zora
              </div>
            </div>
            
            {isWorkspaceMenuOpen && (
              <div 
                ref={menuRef}
                className="absolute top-[100%] left-4 right-4 mt-1 bg-white rounded-xl shadow-lg border border-stone-200 py-1.5 z-50 overflow-hidden"
              >
                <div className="px-3 py-1.5 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                  选择工作区
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-stone-50 transition-colors",
                        ws.id === currentWorkspace?.id ? "text-orange-600 font-medium" : "text-stone-700"
                      )}
                      onClick={() => {
                        setCurrentWorkspaceId(ws.id);
                        setIsWorkspaceMenuOpen(false);
                      }}
                    >
                      <span className="truncate">{ws.name}</span>
                      {ws.id === currentWorkspace?.id && (
                        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-stone-100 mt-1 pt-1">
                  <button className="w-full text-left px-3 py-2 text-sm text-stone-600 flex items-center gap-2 hover:bg-stone-50 transition-colors">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>新建工作区</span>
                  </button>
                </div>
              </div>
            )}
            
            <button
              onClick={toggleSidebar}
              className="rounded-md p-1.5 text-stone-400 hover:bg-stone-200/50 hover:text-stone-600 transition shrink-0 ml-2"
              title="折叠侧边栏"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth={2} />
                <path d="M9 3v18" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">会话</h2>
            <button
              onClick={handleNewChat}
              className="rounded-md p-1.5 text-stone-500 hover:bg-stone-200/50 hover:text-stone-800 transition"
              title="新建会话"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <SessionList />
          </div>

          <div className="border-stone-200/50 p-3">
            <SidebarFooter />
          </div>
        </>
      )}

      {collapsed && (
        <div className="flex h-full flex-col items-center py-4 pt-[62px] justify-between">
          <div className="flex flex-col items-center">
            <button 
              onClick={toggleSidebar}
              className="rounded-md p-2 text-stone-400 hover:bg-stone-200/50 hover:text-stone-600 transition"
              title="展开侧边栏"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth={2} />
                <path d="M9 3v18" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button 
              onClick={handleNewChat}
              className="rounded-md p-2 text-stone-500 hover:bg-stone-200/50 hover:text-stone-800 transition mt-2"
              title="新建会话"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <button 
            className="rounded-md p-2 text-stone-400 hover:bg-stone-200/50 hover:text-stone-600 transition mb-2"
            title="设置"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}
