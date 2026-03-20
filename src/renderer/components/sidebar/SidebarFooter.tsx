import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { loadSkillsAtom, skillsAtom } from "../../store/skill";
import { isSettingsOpenAtom, settingsTabAtom } from "../../store/ui";

/**
 * 侧边栏底部组件
 * 显示 MCP 和 Skills 状态，以及设置按钮
 */
export function SidebarFooter() {
  const skills = useAtomValue(skillsAtom);
  const loadSkills = useSetAtom(loadSkillsAtom);
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center gap-3 px-3 text-[12px] text-stone-500">
        <button
          onClick={() => {
            setSettingsTab("mcp");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1.5 -ml-1.5 py-0.5 hover:bg-stone-200/50"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span>0 MCP</span>
        </button>
        <span className="h-1 w-1 rounded-full bg-stone-300"></span>
        <button
          onClick={() => {
            setSettingsTab("skills");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1.5 -mr-1.5 py-0.5 hover:bg-stone-200/50"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{skills.length} {skills.length === 1 ? "Skill" : "Skills"}</span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setSettingsOpen(!isSettingsOpen)}
        className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] text-stone-500 transition-colors hover:bg-white/50 hover:text-stone-900"
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
        <span>设置</span>
      </button>
    </div>
  );
}
