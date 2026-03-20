import { useAtom, useSetAtom } from "jotai";
import { FeishuSettings } from "./FeishuSettings";
import { ProviderSettings } from "./ProviderSettings";
import { SkillManagerPanel } from "./SkillManagerPanel";
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
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const [settingsTab, setSettingsTab] = useAtom(settingsTabAtom);

  return (
    <div className="relative isolate flex h-full w-full flex-col overflow-hidden bg-white text-stone-900">
      <header className="titlebar-drag-region relative flex h-[38px] shrink-0 items-center justify-end px-5">
        <button
          onClick={() => setSettingsOpen(false)}
          className="titlebar-no-drag rounded-full bg-white p-1.5 text-stone-400 shadow-sm ring-1 ring-stone-200 transition hover:bg-stone-50 hover:text-stone-900"
          title="关闭设置 (Esc)"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="titlebar-no-drag relative flex w-[224px] shrink-0 flex-col border-r border-stone-100 bg-stone-50/30">
          <div className="px-5 py-4">
            <h1 className="text-[18px] font-semibold tracking-[-0.02em]">设置</h1>
            <p className="mt-1 text-[12px] text-stone-500">管理您的 Zora 偏好</p>
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
                    "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-all duration-200",
                    isActive
                      ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200/50"
                      : "text-stone-500 hover:bg-stone-200/40 hover:text-stone-800",
                  ].join(" ")}
                >
                  <div className={isActive ? "text-stone-900" : "text-stone-400"}>{tab.icon}</div>
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="titlebar-no-drag relative flex-1 overflow-y-auto bg-white">
          <div className="mx-auto max-w-3xl px-10 pb-7 pt-4">
            {settingsTab === "provider" ? <ProviderSettings /> : null}
            {settingsTab === "feishu" ? <FeishuSettings /> : null}

            {settingsTab === "skills" ? <SkillManagerPanel /> : null}

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
        </main>
      </div>
    </div>
  );
}
