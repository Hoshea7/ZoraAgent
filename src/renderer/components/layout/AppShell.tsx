import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { fileTreeVisibleAtom } from "../../store/filetree";
import { isSettingsOpenAtom } from "../../store/ui";
import { LeftSidebar } from "./LeftSidebar";
import { MainArea } from "./MainArea";
import { SettingsPanel } from "../settings/SettingsPanel";
import { FileTreePanel } from "../filetree/FileTreePanel";

/**
 * 应用根布局容器
 * 提供整体布局结构：左侧边栏 + 中间对话区域
 */
export function AppShell() {
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const fileTreeVisible = useAtomValue(fileTreeVisibleAtom);
  const [shouldRenderFileTree, setShouldRenderFileTree] = useState(fileTreeVisible);

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

  return (
    <main className="h-screen overflow-hidden overscroll-none bg-[#f5f3f0] text-stone-900 relative">
      {/* 主内容区域：由各自可见的顶部区域提供拖拽能力，避免全局透明层与局部 no-drag 互相冲突 */}
      <div className="relative z-40 flex h-full">
        <LeftSidebar />
        <div className="flex-1 bg-white relative min-w-0 h-full overflow-hidden">
          <div className={isSettingsOpen ? "h-full" : "hidden"} aria-hidden={!isSettingsOpen}>
            <SettingsPanel />
          </div>
          <div className={isSettingsOpen ? "hidden" : "h-full"} aria-hidden={isSettingsOpen}>
            <MainArea />
          </div>
        </div>
        {shouldRenderFileTree ? <FileTreePanel isOpen={fileTreeVisible} /> : null}
      </div>
    </main>
  );
}
