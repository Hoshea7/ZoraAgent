import { useAtomValue, useSetAtom } from "jotai";
import { skillsAtom } from "../../store/skill";
import { isSettingsOpenAtom, openSettingsTabAtom } from "../../store/ui";

/**
 * 侧边栏底部组件
 * 显示 MCP 和 Skills 状态，以及设置按钮
 */
export function SidebarFooter() {
  const skills = useAtomValue(skillsAtom);
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const openSettingsTab = useSetAtom(openSettingsTabAtom);

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center gap-3 px-1 text-[12px] text-stone-500">
        <button
          type="button"
          onClick={() => openSettingsTab("mcp")}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-white/45 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/70"
          title="打开 MCP 设置"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          <span>0 MCP</span>
        </button>
        <span className="h-1 w-1 rounded-full bg-stone-300"></span>
        <button
          type="button"
          onClick={() => openSettingsTab("skills")}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-white/45 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/70"
          title="打开 Skills 设置"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{skills.length} {skills.length === 1 ? "Skill" : "Skills"}</span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setSettingsOpen(!isSettingsOpen)}
        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition hover:bg-white/45 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/70 ${
          isSettingsOpen ? "font-medium text-stone-900" : "text-stone-600"
        }`}
      >
        <svg
          className={`h-4 w-4 ${isSettingsOpen ? "text-stone-700" : "text-stone-500"}`}
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
