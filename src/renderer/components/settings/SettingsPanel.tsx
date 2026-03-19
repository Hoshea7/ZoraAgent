import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { FeishuSettings } from "./FeishuSettings";
import { ProviderSettings } from "./ProviderSettings";
import { loadSkillsAtom, skillsAtom } from "../../store/skill";
import { isSettingsOpenAtom, settingsTabAtom } from "../../store/ui";

const tabs = [
  {
    id: "provider",
    label: "模型配置",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
  },
  {
    id: "feishu",
    label: "飞书",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-6 4h10M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H9l-4 3v-3H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
      </svg>
    ),
  },
  {
    id: "skills",
    label: "Skills",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: "mcp",
    label: "MCP",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
] as const;

export function SettingsPanel() {
  const skills = useAtomValue(skillsAtom);
  const loadSkills = useSetAtom(loadSkillsAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const [settingsTab, setSettingsTab] = useAtom(settingsTabAtom);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  return (
    <div className="flex h-full w-full bg-white text-stone-900 overflow-hidden relative">
      {/* 顶部拖拽区 - 整个顶部固定一条高度为28px的拖拽手柄 */}
      <div className="titlebar-drag-region absolute inset-x-0 top-0 h-7 z-50 bg-transparent" />
      
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-stone-100 bg-stone-50/30 pt-7 relative z-40 titlebar-no-drag">
        <div className="px-6 pt-6 pb-6 mt-4">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">设置</h1>
          <p className="mt-1 text-[13px] text-stone-500">管理您的 Zora 偏好</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 pointer-events-auto">
          {tabs.map((tab) => {
            const isActive = settingsTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSettingsTab(tab.id)}
                className={[
                  "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition-all duration-200",
                  isActive
                    ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200/50"
                    : "text-stone-500 hover:bg-stone-200/40 hover:text-stone-800"
                ].join(" ")}
              >
                <div className={isActive ? "text-stone-900" : "text-stone-400"}>
                  {tab.icon}
                </div>
                {tab.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="relative flex-1 overflow-y-auto bg-white pt-7 z-10 titlebar-no-drag">
        <div className="mx-auto max-w-3xl px-12 py-8 mt-2">
          {settingsTab === "provider" ? <ProviderSettings /> : null}
          {settingsTab === "feishu" ? <FeishuSettings /> : null}

          {settingsTab === "skills" ? (
            <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-[24px] font-semibold tracking-tight text-stone-900">Skills</h2>
                  <p className="mt-1 text-[14px] text-stone-500">管理和配置本地的 Agent 技能集。</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void window.zora.openSkillsDir();
                  }}
                  className="group flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-1.5 text-[13px] font-medium text-stone-600 transition hover:bg-stone-200 hover:text-stone-900"
                >
                  <svg className="h-4 w-4 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  打开目录
                </button>
              </div>

              <div className="overflow-hidden rounded-[16px] border border-stone-200 bg-white shadow-sm ring-1 ring-black/5">
                {skills.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-50">
                      <svg className="h-6 w-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <p className="mt-4 text-[14px] font-medium text-stone-900">暂未发现可用 Skill</p>
                    <p className="mt-1 text-[13px] text-stone-500">把您的技能包放到指定的目录下即可加载。</p>
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100">
                    {skills.map((skill) => (
                      <div
                        key={skill.path}
                        className="group flex items-center justify-between px-6 py-4 transition-colors hover:bg-stone-50/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-[15px] font-medium text-stone-900">{skill.name}</h3>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[12px] text-stone-500">
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-stone-500">
                              {skill.dirName}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void window.zora.openSkillDir(skill.dirName);
                          }}
                          className="ml-4 shrink-0 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-medium text-stone-600 opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:bg-stone-50 hover:text-stone-900 focus:opacity-100"
                        >
                          查看详情
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {settingsTab === "mcp" ? (
            <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-6">
                <h2 className="text-[24px] font-semibold tracking-tight text-stone-900">MCP</h2>
                <p className="mt-1 text-[14px] text-stone-500">管理 Model Context Protocol (MCP) 服务器配置。</p>
              </div>
              <div className="overflow-hidden rounded-[16px] border border-stone-200 bg-white shadow-sm ring-1 ring-black/5">
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-50">
                    <svg className="h-6 w-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="mt-4 text-[14px] font-medium text-stone-900">暂未配置 MCP</p>
                  <p className="mt-1 text-[13px] text-stone-500">配置 MCP 以扩展模型的上下文能力。</p>
                  <button className="mt-5 rounded-full bg-stone-900 px-4 py-2 text-[13px] font-medium text-white opacity-50 shadow-sm cursor-not-allowed">
                    配置 MCP
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
        
        <button
          onClick={() => setSettingsOpen(false)}
          className="absolute right-6 top-5 rounded-full bg-white p-2 text-stone-400 shadow-sm ring-1 ring-stone-200 transition hover:bg-stone-50 hover:text-stone-900 z-50 pointer-events-auto"
          title="关闭设置 (Esc)"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </main>
    </div>
  );
}
