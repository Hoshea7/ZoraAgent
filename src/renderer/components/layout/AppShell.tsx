import { LeftSidebar } from "./LeftSidebar";
import { MainArea } from "./MainArea";

/**
 * 应用根布局容器
 * 提供整体布局结构：左侧边栏 + 中间对话区域
 */
export function AppShell() {
  return (
    <main className="h-screen overflow-hidden bg-[#f5f3f0] text-stone-900">
      {/* macOS 拖动区域 - 顶部 50px，与侧边栏同色 */}
      <div className="titlebar-drag-region fixed left-0 right-0 top-0 z-50 h-[50px] bg-[#f5f3f0]" />

      {/* 主内容区域 */}
      <div className="relative z-[60] flex h-full">
        <LeftSidebar />
        <div className="flex-1 bg-white pt-[50px]">
          <MainArea />
        </div>
      </div>
    </main>
  );
}
