import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { fileTreeVisibleAtom } from "../../store/filetree";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_TOGGLE_DURATION_MS,
  activeMainViewAtom,
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "../../store/ui";
import { LeftSidebar } from "./LeftSidebar";
import { MainArea } from "./MainArea";
import { SettingsPanel } from "../settings/SettingsPanel";
import { FileTreePanel } from "../filetree/FileTreePanel";
import { SchedulePage } from "../schedule/SchedulePage";

/**
 * 应用根布局容器
 * 提供整体布局结构：左侧边栏 + 中间会话区域
 */
export function AppShell() {
  const activeMainView = useAtomValue(activeMainViewAtom);
  const fileTreeVisible = useAtomValue(fileTreeVisibleAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const [shouldRenderFileTree, setShouldRenderFileTree] = useState(fileTreeVisible);
  const workspaceShellRef = useRef<HTMLDivElement>(null);
  const previousSidebarCollapsedRef = useRef(sidebarCollapsed);
  const isChatView = activeMainView === "chat";
  const isScheduleView = activeMainView === "schedule";
  const isSettingsView = activeMainView === "settings";

  useEffect(() => {
    if (fileTreeVisible) {
      setShouldRenderFileTree(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setShouldRenderFileTree(false);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fileTreeVisible]);

  useLayoutEffect(() => {
    const wasCollapsed = previousSidebarCollapsedRef.current;
    previousSidebarCollapsedRef.current = sidebarCollapsed;

    if (
      wasCollapsed === sidebarCollapsed ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const workspaceShell = workspaceShellRef.current;
    if (!workspaceShell) {
      return;
    }

    const distance = sidebarWidth - SIDEBAR_COLLAPSED_WIDTH;
    const startOffset = sidebarCollapsed ? distance : -distance;
    const animation = workspaceShell.animate(
      [
        { transform: `translate3d(${startOffset}px, 0, 0)` },
        { transform: "translate3d(0, 0, 0)" },
      ],
      {
        duration: SIDEBAR_TOGGLE_DURATION_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );

    return () => animation.cancel();
  }, [sidebarCollapsed, sidebarWidth]);

  return (
    <main className="h-screen overflow-hidden overscroll-none bg-[#f5f3f0] text-stone-900 relative">
      {/* 主内容区域：由各自可见的顶部区域提供拖拽能力，避免全局透明层与局部 no-drag 互相冲突 */}
      <div className="relative z-40 flex h-full">
        <LeftSidebar />
        <div
          ref={workspaceShellRef}
          className="flex h-full min-w-0 flex-1"
          data-testid="workspace-shell"
        >
          <div className="relative h-full min-w-0 flex-1 overflow-hidden bg-white">
            <div className={isSettingsView ? "h-full" : "hidden"} aria-hidden={!isSettingsView}>
              <SettingsPanel />
            </div>
            <div className={isScheduleView ? "h-full" : "hidden"} aria-hidden={!isScheduleView}>
              <SchedulePage />
            </div>
            <div className={isChatView ? "h-full" : "hidden"} aria-hidden={!isChatView}>
              <MainArea />
            </div>
          </div>
          {shouldRenderFileTree ? <FileTreePanel isOpen={fileTreeVisible} /> : null}
        </div>
      </div>
    </main>
  );
}
