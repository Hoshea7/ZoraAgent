import { useAtom } from "jotai";
import { sidebarCollapsedAtom } from "../../store/ui";
import { cn } from "../../utils/cn";
import { ModeToggle } from "../sidebar/ModeToggle";
import { WorkspaceList } from "../sidebar/WorkspaceList";
import { SessionList } from "../sidebar/SessionList";
import { SidebarFooter } from "../sidebar/SidebarFooter";

/**
 * 左侧边栏组件
 * 包含模式切换、工作区列表、会话列表和底部状态
 */
export function LeftSidebar() {
  const [collapsed] = useAtom(sidebarCollapsedAtom);

  return (
    <aside
      className={cn(
        "titlebar-no-drag flex h-full flex-col overflow-hidden rounded-[28px] border border-stone-900/10 bg-white/90 shadow-[0_25px_80px_rgba(90,55,28,0.16)] transition-all duration-300",
        collapsed ? "w-12" : "w-[280px]"
      )}
    >
      {!collapsed && (
        <>
          {/* 顶部区域 */}
          <div className="space-y-4 p-4">
            <ModeToggle />
            <WorkspaceList />
          </div>

          {/* 会话列表区域 */}
          <div className="flex-1 overflow-y-auto px-4">
            <SessionList />
          </div>

          {/* 底部区域 */}
          <div className="p-4">
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
