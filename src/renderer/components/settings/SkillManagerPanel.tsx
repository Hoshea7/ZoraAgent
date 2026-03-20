import { useCallback, useEffect, useState, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { SkillMeta } from "../../../shared/zora";
import type {
  DiscoveredSkill,
  DiscoveryResult,
  ImportMethod,
} from "../../../shared/types/skill";
import { loadSkillsAtom, skillsAtom } from "../../store/skill";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";

type TabId = "installed" | "discover";
type Notice = { tone: "error" | "success"; message: string } | null;

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.75 7.5a1.5 1.5 0 011.5-1.5h4.01a1.5 1.5 0 011.11.49l.9 1.01h7.48a1.5 1.5 0 011.5 1.5v7.5a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-9z" />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 3l-1.8 4.6L6.6 9.4l4.6 1.8L13 16l1.8-4.8 4.6-1.8-4.6-1.8L13 3z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function GlobalToast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [notice, onClose]);

  if (!notice) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-full px-5 py-3 shadow-lg ring-1 text-[13px] font-medium backdrop-blur-md",
          notice.tone === "success"
            ? "bg-emerald-500/90 text-white ring-emerald-600/20"
            : "bg-rose-500/90 text-white ring-rose-600/20"
        )}
      >
        {notice.tone === "success" ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <CloseIcon className="h-4 w-4" />
        )}
        {notice.message}
      </div>
    </div>
  );
}

function SectionCollapse({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-1.5 px-1 py-1 text-[12px] font-medium text-stone-500 transition-colors hover:text-stone-800"
      >
        <ChevronIcon
          className={cn("h-3.5 w-3.5 transition-transform duration-200", isOpen ? "rotate-90" : "")}
        />
        {title}
        {count !== undefined && (
          <span className="ml-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] leading-none text-stone-500">
            {count}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="overflow-hidden rounded-[12px] border border-stone-200/60 bg-white shadow-sm">
          <div className="">{children}</div>
        </div>
      )}
    </div>
  );
}

function InstalledSkillItem({
  skill,
  uninstalling,
  onUninstall,
  onOpenDir,
}: {
  skill: SkillMeta;
  uninstalling: boolean;
  onUninstall: (dirName: string) => void;
  onOpenDir: (dirName: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="group flex flex-col transition-colors hover:bg-stone-50/70 border-b border-stone-100/50 last:border-0">
      <div 
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={(e) => {
          // Prevent expansion when clicking buttons
          if ((e.target as HTMLElement).closest('button')) return;
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-stone-100 text-stone-400">
          <SparkIcon className="h-3.5 w-3.5" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[13px] font-medium text-stone-900">{skill.name}</span>
          <span className="rounded bg-stone-100/80 px-1.5 py-0.5 font-sans text-[10px] font-medium tracking-wide text-stone-500">
            {skill.dirName}
          </span>
        </div>
        <div className="min-w-0 flex-1 flex items-center gap-2 pr-4">
          <span className="truncate text-[12px] text-stone-400">{skill.description}</span>
        </div>
        
        {/* Actions - Always visible but subtle */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenDir(skill.dirName)}
            className="rounded p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700 transition"
            title="打开技能目录"
          >
            <FolderIcon className="h-4 w-4" />
          </button>
          
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onUninstall(skill.dirName);
                  setConfirming(false);
                }}
                disabled={uninstalling}
                className="rounded bg-rose-500 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-rose-600 disabled:opacity-50"
              >
                确认卸载
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={uninstalling}
                className="rounded bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-600 transition hover:bg-stone-200 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={uninstalling}
              className="rounded px-2 py-1 text-[11px] font-medium text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition disabled:opacity-50"
            >
              {uninstalling ? "卸载中" : "卸载"}
            </button>
          )}
        </div>
      </div>

      {/* Expandable Details Panel */}
      {isExpanded && (
        <div className="pl-[36px] pr-4 pb-3 animate-in slide-in-from-top-2 fade-in duration-200">
          <p className="text-[13px] leading-relaxed text-stone-500 whitespace-pre-wrap">
            {skill.description}
          </p>
        </div>
      )} {
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  if (skill.alreadyInZora) {
    return (
      <div className="flex flex-col border-b border-stone-100/50 last:border-0">
        <div 
          className="flex items-center gap-3 px-3 py-2.5 bg-stone-50/30 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-stone-100/50 text-stone-300">
            <CheckIcon className="h-3.5 w-3.5" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[13px] font-medium text-stone-500">{skill.name}</span>
            <span className="rounded bg-stone-100/50 px-1.5 py-0.5 font-sans text-[10px] font-medium tracking-wide text-stone-400">
              {toolName}
            </span>
          </div>
          <div className="min-w-0 flex-1 pr-4">
            <span className="truncate text-[12px] text-stone-400">{skill.description}</span>
          </div>
          <div className="shrink-0 pr-2 text-[11px] text-stone-400">已导入</div>
        </div>
        
        {isExpanded && (
        <div className="pl-[36px] pr-4 pb-3 animate-in slide-in-from-top-2 fade-in duration-200">
          <p className="text-[13px] leading-relaxed text-stone-500 whitespace-pre-wrap">
            {skill.description}
          </p>
        </div>
      )};
    } finally {
      setLoadingInstalled(false);
    }
  }, [loadSkills]);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  const handleScan = useCallback(async () => {
    setLoadingDiscovery(true);
    try {
      const result = await window.zora.discoverSkills();
      setDiscoveryResult(result);
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setLoadingDiscovery(false);
    }
  }, []);

  const handleOpenDir = useCallback(async (dirName: string) => {
    try {
      await window.zora.openSkillDir(dirName);
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    }
  }, []);

  const handleOpenSkillsDir = useCallback(async () => {
    try {
      await window.zora.openSkillsDir();
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    }
  }, []);

  const handleUninstall = useCallback(
    async (dirName: string) => {
      setUninstallingDirName(dirName);
      try {
        await window.zora.uninstallSkill(dirName);
        await refreshInstalled();
        if (discoveryResult) {
          await handleScan();
        }
        setNotice({ tone: "success", message: `已卸载 "${dirName}"。` });
      } catch (error) {
        setNotice({ tone: "error", message: getErrorMessage(error) });
      } finally {
        setUninstallingDirName(null);
      }
    },
    [discoveryResult, handleScan, refreshInstalled]
  );

  const handleImport = useCallback(
    async (skill: DiscoveredSkill, method: ImportMethod) => {
      const key = importKeyFor(skill);
      setImportingSet((current) => new Set(current).add(key));

      try {
        const result = await window.zora.importSkill(
          skill.sourcePath,
          method,
          skill.sourceTool,
          skill.dirName
        );

        if (!result.success) {
          setNotice({
            tone: "error",
            message: result.error ?? `导入 "${skill.name}" 失败。`,
          });
          return;
        }

        await refreshInstalled();
        await handleScan();
        setNotice({
          tone: "success",
          message: `已通过 ${method} 导入 "${skill.name}"。`,
        });
      } catch (error) {
        setNotice({ tone: "error", message: getErrorMessage(error) });
      } finally {
        setImportingSet((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [handleScan, refreshInstalled]
  );

  // Derived data for Discover tab
  const allDiscoverSkills = useMemo(() => {
    if (!discoveryResult) return [];
    return discoveryResult.tools
      .filter((t) => t.exists)
      .flatMap((t) => t.skills.map((s) => ({ skill: s, toolName: t.tool.name })));
  }, [discoveryResult]);

  const filteredDiscoverSkills = useMemo(() => {
    return allDiscoverSkills.filter(
      ({ skill }) =>
        skill.name.toLowerCase().includes(discoverSearch.toLowerCase()) ||
        skill.description.toLowerCase().includes(discoverSearch.toLowerCase())
    );
  }, [allDiscoverSkills, discoverSearch]);

  const newDiscoverSkills = filteredDiscoverSkills.filter(({ skill }) => !skill.alreadyInZora);
  const importedDiscoverSkills = filteredDiscoverSkills.filter(({ skill }) => skill.alreadyInZora);

  // Derived data for Installed tab
  const filteredInstalledSkills = useMemo(() => {
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(installedSearch.toLowerCase()) ||
        s.description.toLowerCase().includes(installedSearch.toLowerCase())
    );
  }, [skills, installedSearch]);

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex flex-col gap-1.5 border-b border-stone-100 pb-5">
        <h2 className="text-[28px] font-bold tracking-tight text-stone-900">技能管理</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-stone-400">
          管理 Zora 可用的扩展技能。您可以卸载不需要的技能，或从其他 AI 工具快速导入。
        </p>
      </div>

      <div className="mb-6 inline-flex rounded-[14px] border-none bg-stone-100/50 p-1 shadow-none">
        <button
          type="button"
          onClick={() => setTab("installed")}
          className={cn(
            "rounded-[10px] px-4 py-1.5 text-[13px] font-medium transition",
            tab === "installed"
              ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
              : "text-stone-500 hover:text-stone-800"
          )}
        >
          已安装 {skills.length > 0 && `(${skills.length})`}
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("discover");
            if (!discoveryResult && !loadingDiscovery) {
              void handleScan();
            }
          }}
          className={cn(
            "rounded-[10px] px-4 py-1.5 text-[13px] font-medium transition",
            tab === "discover"
              ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
              : "text-stone-500 hover:text-stone-800"
          )}
        >
          发现 {discoveryResult?.totalNew ? `(${discoveryResult.totalNew})` : ""}
        </button>
      </div>

      <GlobalToast notice={notice} onClose={() => setNotice(null)} />

      {tab === "installed" && (
        <div className="space-y-4">
          {/* 统一操作栏 */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <SearchIcon className="h-3.5 w-3.5 text-stone-400" />
              </div>
              <input
                type="search"
                placeholder="搜索已安装技能..."
                value={installedSearch}
                onChange={(e) => setInstalledSearch(e.target.value)}
                className="w-full rounded-[8px] border border-stone-200/80 bg-stone-50/50 py-1.5 pl-8 pr-3 text-[12px] outline-none transition-all placeholder:text-stone-400 focus:bg-white focus:border-stone-300 focus:ring-1 focus:ring-stone-300"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenSkillsDir}
              className="h-7 px-3 py-0 text-[12px]"
            >
              打开目录
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshInstalled()}
              disabled={loadingInstalled}
              className="h-7 px-3 py-0 text-[12px]"
            >
              {loadingInstalled ? (
                <div className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  刷新中...
                </div>
              ) : "刷新"}
            </Button>
          </div>

          {/* 列表渲染 */}
          {skills.length === 0 && !loadingInstalled ? (
            <div className="rounded-[16px] border border-dashed border-stone-300 bg-stone-50/70 py-10 text-center">
              <h3 className="text-[14px] font-semibold text-stone-900">暂无已安装的技能</h3>
              <p className="mt-1.5 text-[12px] text-stone-500">
                切换到“发现”以导入技能，或让 Zora 为您安装。
              </p>
            </div>
          ) : filteredInstalledSkills.length === 0 && installedSearch ? (
            <div className="rounded-[16px] border border-stone-200 bg-white py-10 text-center shadow-sm">
              <p className="text-[12px] text-stone-500">未找到符合条件的技能</p>
            </div>
          ) : (
            <SectionCollapse title="已安装的技能" count={filteredInstalledSkills.length}>
              {filteredInstalledSkills.map((skill) => (
                <InstalledSkillItem
                  key={skill.dirName}
                  skill={skill}
                  uninstalling={uninstallingDirName === skill.dirName}
                  onUninstall={(dirName) => void handleUninstall(dirName)}
                  onOpenDir={(dirName) => void handleOpenDir(dirName)}
                />
              ))}
            </SectionCollapse>
          )}
        </div>
      )}

      {tab === "discover" && (
        <div className="space-y-4">
          {/* 统一操作栏 */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <SearchIcon className="h-3.5 w-3.5 text-stone-400" />
              </div>
              <input
                type="search"
                placeholder="搜索未导入技能..."
                value={discoverSearch}
                onChange={(e) => setDiscoverSearch(e.target.value)}
                className="w-full rounded-[8px] border border-stone-200/80 bg-stone-50/50 py-1.5 pl-8 pr-3 text-[12px] outline-none transition-all placeholder:text-stone-400 focus:bg-white focus:border-stone-300 focus:ring-1 focus:ring-stone-300"
                disabled={!discoveryResult}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleScan()}
              disabled={loadingDiscovery}
              className="h-7 px-3 py-0 text-[12px] shadow-none"
            >
              {loadingDiscovery ? (
                <div className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  扫描中...
                </div>
              ) : "重新扫描"}
            </Button>
          </div>

          {/* 列表渲染 */}
          {!discoveryResult ? (
            <div className="rounded-[16px] border border-dashed border-stone-300 bg-stone-50/70 py-10 text-center">
              <h3 className="text-[14px] font-semibold text-stone-900">准备扫描</h3>
              <p className="mt-1.5 text-[12px] text-stone-500">
                Zora 可以自动发现本机其他 AI 工具中的技能并导入。
              </p>
            </div>
          ) : allDiscoverSkills.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-stone-300 bg-stone-50/70 py-10 text-center">
              <h3 className="text-[14px] font-semibold text-stone-900">未发现可导入的技能</h3>
              <p className="mt-1.5 text-[12px] text-stone-500">
                请先在 Claude Code 等工具中安装技能后重试。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 未导入的新技能平铺 */}
              {newDiscoverSkills.length > 0 ? (
                <div className="overflow-hidden rounded-[12px] border border-stone-200/60 bg-white shadow-sm">
                  <div className="">
                    {newDiscoverSkills.map(({ skill, toolName }) => (
                      <DiscoverSkillItem
                        key={importKeyFor(skill)}
                        skill={skill}
                        toolName={toolName}
                        importing={importingSet.has(importKeyFor(skill))}
                        onImport={(s, m) => void handleImport(s, m)}
                      />
                    ))}
                  </div>
                </div>
              ) : discoverSearch ? (
                <div className="rounded-[16px] border border-stone-200 bg-white py-10 text-center shadow-sm">
                  <p className="text-[12px] text-stone-500">未找到未导入的新技能</p>
                </div>
              ) : null}

              {/* 已导入的重复技能折叠 */}
              {importedDiscoverSkills.length > 0 && (
                <SectionCollapse
                  title="已在本地的重复技能"
                  count={importedDiscoverSkills.length}
                  defaultOpen={false}
                >
                  {importedDiscoverSkills.map(({ skill, toolName }) => (
                    <DiscoverSkillItem
                      key={importKeyFor(skill)}
                      skill={skill}
                      toolName={toolName}
                      importing={false}
                      onImport={(s, m) => void handleImport(s, m)}
                    />
                  ))}
                </SectionCollapse>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
