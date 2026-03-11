import { LeftSidebar } from "./LeftSidebar";
import { MainArea } from "./MainArea";

/**
 * 应用根布局容器
 * 提供整体布局结构：左侧边栏 + 中间对话区域
 */
export function AppShell() {
  return (
    <main className="h-screen overflow-hidden bg-[linear-gradient(180deg,_#f8f1e3_0%,_#efe3cf_42%,_#eadcc7_100%)] text-stone-900">
      {/* macOS 拖动区域 - 顶部 50px */}
      <div className="titlebar-drag-region fixed left-0 right-0 top-0 z-50 h-[50px]" />

      {/* 主内容区域 */}
      <div className="relative z-[60] flex h-full gap-4 px-4 pt-[58px] pb-5 sm:px-6 sm:pb-6">
        <div className="mx-auto flex h-full w-full max-w-7xl gap-4">
          <LeftSidebar />
          <div className="flex-1">
            <MainArea />
          </div>
        </div>
      </div>
    </main>
  );
}
