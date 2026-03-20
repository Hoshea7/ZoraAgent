import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { loadSkillsAtom } from "../../store/skill";
import { isSettingsOpenAtom } from "../../store/ui";
import { LeftSidebar } from "./LeftSidebar";
import { MainArea } from "./MainArea";
import { SettingsPanel } from "../settings/SettingsPanel";

/**
 * 应用根布局容器
 * 提供整体布局结构：左侧边栏 + 中间对话区域
 */
export function AppShell() {
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const loadSkills = useSetAtom(loadSkillsAtom);

  useEffect(() => {
    const refreshSkills = () => {
      if (document.hidden) {
        return;
      }

      void loadSkills().catch((error) => {
        console.warn("[app-shell] Failed to refresh skills.", error);
      });
    };

    void loadSkills().catch((error) => {
      console.warn("[app-shell] Failed to load skills.", error);
    });

    const unsubscribe = window.zora.onSkillsChanged(refreshSkills);
    window.addEventListener("focus", refreshSkills);
    document.addEventListener("visibilitychange", refreshSkills);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshSkills);
      document.removeEventListener("visibilitychange", refreshSkills);
    };
  }, [loadSkills]);

  return (
    <main className="h-screen overflow-hidden overscroll-none bg-[#f5f3f0] text-stone-900 relative">
      {/* 主内容区域：由各自可见的顶部区域提供拖拽能力，避免全局透明层与局部 no-drag 互相冲突 */}
      <div className="relative z-40 flex h-full">
        <LeftSidebar />
        <div className="flex-1 bg-white relative min-w-0 h-full overflow-hidden">
          {isSettingsOpen ? <SettingsPanel /> : <MainArea />}
        </div>
      </div>
    </main>
  );
}
