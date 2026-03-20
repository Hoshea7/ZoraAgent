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

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function ChevronIcon({ className, expanded }: { className?: string; expanded?: boolean }) {
  return (
    <svg className={cn("transition-transform duration-200", expanded ? "rotate-90" : "", className)} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
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
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4 fade-in duration-300">
      <div
        className={cn(
          "rounded-full px-4 py-2 text-[13px] font-medium shadow-md border flex items-center gap-2",
          notice.tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-rose-200 bg-rose-50 text-rose-700"
        )}
      >
        {notice.message}
      </div>
    </div>
  );
}

function SkillGroup({ title, count, children, defaultExpanded = true }: { title: string; count: number; children: React.ReactNode; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  if (count === 0) return null;
  
  return (
    <div className="space-y-2">
      <button 
        onClick={() => setExpanded(!expanded)} 
        className="flex items-center gap-1.5 text-[13px] font-medium text-stone-500 hover:text-stone-800 transition-colors py-1"
      >
        <ChevronIcon className="h-4 w-4" expanded={expanded} />
        {title} ({count})
      </button>
      {expanded && (
        <div className="space-y-2 pl-1">
          {children}
        </div>
      )}
    </div>
  );
}

function InstalledSkillCard({
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
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isEnabled = (skill as any).enabled !== false;

  return (
    <div className="border border-stone-200 bg-white rounded-md overflow-hidden transition-colors hover:border-stone-300">
      <div 
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-stone-50/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <SparkIcon className="h-4 w-4 text-stone-400 shrink-0" />
          <h3 className={cn("text-[13px] font-medium shrink-0", !isEnabled ? "text-stone-400" : "text-stone-900")}>
            {skill.name}
          </h3>
          <span className="text-stone-300 shrink-0">-</span>
          <p className="truncate text-[13px] text-stone-500">
            {skill.description || "无描述"}
          </p>
        </div>
        
        <div className="flex shrink-0 items-center gap-2">
          {!isEnabled && (
             <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500 mr-2">
               已停用
             </span>
          )}
          
          <button
            title="打开技能目录"
            onClick={(e) => { e.stopPropagation(); onOpenDir(skill.dirName); }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <FolderIcon className="h-4 w-4" />
          </button>
          
          {confirming ? (
            <div className="flex items-center gap-1.5 ml-1" onClick={e => e.stopPropagation()}>
              <Button
                variant="primary"
                size="sm"
                className="h-7 px-2 text-[12px] bg-rose-500 hover:bg-rose-600 border-rose-500 text-white shadow-none"
                disabled={uninstalling}
                onClick={(e) => { e.stopPropagation(); onUninstall(skill.dirName); setConfirming(false); }}
              >
                确认
              </Button>
              <button onClick={() => setConfirming(false)} className="text-stone-400 hover:text-stone-700"><CloseIcon className="h-4 w-4" /></button>
            </div>
          ) : (
            <button
              title={uninstalling ? "卸载中..." : "卸载技能"}
              disabled={uninstalling}
              onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          
          <div className="w-px h-4 bg-stone-200 mx-1"></div>
          <ChevronIcon className="h-4 w-4 text-stone-400" expanded={expanded} />
        </div>
      </div>

      {expanded && (
        <div className="bg-[#F9FAFB] border-t border-stone-100 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-stone-600 whitespace-pre-wrap">
            {skill.description || "该技能未提供详细描述。"}
          </p>
        </div>
      )}
    </div>
  );
}

function InstalledTab({
  skills,
  loading,
  uninstallingDirName,
  onRefresh,
  onUninstall,
  onOpenDir,
  onOpenSkillsDir,
}: {
  skills: SkillMeta[];
  loading: boolean;
  uninstallingDirName: string | null;
  onRefresh: () => void;
  onUninstall: (dirName: string) => void;
  onOpenDir: (dirName: string) => void;
  onOpenSkillsDir: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  
  const filteredSkills = useMemo(() => {
    return skills.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (s.description || "").toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [skills, searchQuery]);
  
  const activeSkills = filteredSkills.filter(s => (s as any).enabled !== false);
  const disabledSkills = filteredSkills.filter(s => (s as any).enabled === false);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <SearchIcon className="h-4 w-4 text-stone-400" />
          </div>
          <input
            type="search"
            placeholder="搜索已安装技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[8px] border border-stone-200 bg-white py-1.5 pl-9 pr-3 text-[13px] outline-none placeholder:text-stone-400 focus:border-stone-300 transition-colors"
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshIcon className="h-3.5 w-3.5 mr-1" /> {loading ? "刷新中" : "刷新"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenSkillsDir}>
            <FolderIcon className="h-3.5 w-3.5 mr-1" /> 技能目录
          </Button>
        </div>
      </div>

      {skills.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/70 px-8 py-12 text-center shadow-none">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
            <SparkIcon className="h-6 w-6 text-stone-500" />
          </div>
          <h3 className="mt-5 text-[15px] font-semibold text-stone-900">
            暂无已安装的技能
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6 text-stone-500">
            点击“发现”从其他工具导入，或直接让 Zora 为您安装新技能。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <SkillGroup title="已安装技能" count={activeSkills.length} defaultExpanded={true}>
            {activeSkills.map((skill) => (
              <InstalledSkillCard
                key={skill.dirName}
                skill={skill}
                uninstalling={uninstallingDirName === skill.dirName}
                onUninstall={onUninstall}
                onOpenDir={onOpenDir}
              />
            ))}
          </SkillGroup>
          
          <SkillGroup title="已停用" count={disabledSkills.length} defaultExpanded={false}>
            {disabledSkills.map((skill) => (
              <InstalledSkillCard
                key={skill.dirName}
                skill={skill}
                uninstalling={uninstallingDirName === skill.dirName}
                onUninstall={onUninstall}
                onOpenDir={onOpenDir}
              />
            ))}
          </SkillGroup>
        </div>
      )}
    </div>
  );
}

function importKeyFor(skill: DiscoveredSkill) {
  return `${skill.sourceTool}:${skill.dirName}`;
}

function DiscoverSkillCard({
  skill,
  toolName,
  importing,
  onImport,
}: {
  skill: DiscoveredSkill;
  toolName: string;
  importing: boolean;
  onImport: (skill: DiscoveredSkill, method: ImportMethod) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  
  const isImported = skill.alreadyInZora;

  return (
    <div className="border border-stone-200 bg-white rounded-md overflow-hidden transition-colors hover:border-stone-300">
      <div 
        className={cn("flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors", isImported ? "bg-stone-50/50 opacity-70" : "hover:bg-stone-50/50")}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <SparkIcon className="h-4 w-4 text-stone-400 shrink-0" />
          <h3 className="text-[13px] font-medium text-stone-900 shrink-0">
            {skill.name}
          </h3>
          <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 font-sans text-[10px] font-medium tracking-wide text-stone-500">
            {toolName}
          </span>
          <span className="text-stone-300 shrink-0">-</span>
          <p className="truncate text-[13px] text-stone-500">
            {skill.description || "无描述"}
          </p>
        </div>
        
        <div className="flex shrink-0 items-center gap-2">
          {isImported ? (
            <div className="flex items-center gap-1 text-stone-400 text-[12px] mr-2">
              <CheckIcon className="h-3.5 w-3.5" /> 已导入
            </div>
          ) : showMethodPicker ? (
             <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
               <Button size="sm" variant="secondary" className="h-7 px-2 text-[12px]" disabled={importing} onClick={() => { onImport(skill, "symlink"); setShowMethodPicker(false); }} title="保持与源文件同步">软链接</Button>
               <Button size="sm" variant="secondary" className="h-7 px-2 text-[12px]" disabled={importing} onClick={() => { onImport(skill, "copy"); setShowMethodPicker(false); }} title="作为独立副本">复制</Button>
               <button onClick={() => setShowMethodPicker(false)} className="text-stone-400 hover:text-stone-700 ml-1"><CloseIcon className="h-4 w-4" /></button>
             </div>
          ) : (
            <button
              title={importing ? "导入中..." : "导入技能"}
              disabled={importing}
              onClick={(e) => { e.stopPropagation(); setShowMethodPicker(true); }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
          <div className="w-px h-4 bg-stone-200 mx-1"></div>
          <ChevronIcon className="h-4 w-4 text-stone-400" expanded={expanded} />
        </div>
      </div>
      
      {expanded && (
        <div className="bg-[#F9FAFB] border-t border-stone-100 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-stone-600 whitespace-pre-wrap">
            {skill.description || "该技能未提供详细描述。"}
          </p>
        </div>
      )}
    </div>
  );
}

function DiscoverTab({
  result,
  loading,
  importingSet,
  onScan,
  onImport,
}: {
  result: DiscoveryResult | null;
  loading: boolean;
  importingSet: Set<string>;
  onScan: () => void;
  onImport: (skill: DiscoveredSkill, method: ImportMethod) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const allSkills = useMemo(() => {
    if (!result) return [];
    return result.tools
      .filter((t) => t.exists)
      .flatMap((t) => t.skills.map((s) => ({ skill: s, toolName: t.tool.name })));
  }, [result]);

  const filteredSkills = useMemo(() => {
    return allSkills.filter(
      ({ skill }) =>
        skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allSkills, searchQuery]);

  const newSkills = filteredSkills.filter(({ skill }) => !skill.alreadyInZora);
  const importedSkills = filteredSkills.filter(({ skill }) => skill.alreadyInZora);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <SearchIcon className="h-4 w-4 text-stone-400" />
          </div>
          <input
            type="search"
            placeholder="搜索未导入技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[8px] border border-stone-200 bg-white py-1.5 pl-9 pr-3 text-[13px] outline-none placeholder:text-stone-400 focus:border-stone-300 transition-colors"
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={onScan} disabled={loading}>
            <RefreshIcon className="h-3.5 w-3.5 mr-1" /> {loading ? "扫描中" : "重新扫描"}
          </Button>
        </div>
      </div>

      {result ? (
        allSkills.length > 0 ? (
          <div className="space-y-4">
            {newSkills.length > 0 ? (
              <SkillGroup title="未导入的新技能" count={newSkills.length} defaultExpanded={true}>
                <div className="space-y-2">
                  {newSkills.map(({ skill, toolName }) => (
                    <DiscoverSkillCard
                      key={importKeyFor(skill)}
                      skill={skill}
                      toolName={toolName}
                      importing={importingSet.has(importKeyFor(skill))}
                      onImport={onImport}
                    />
                  ))}
                </div>
              </SkillGroup>
            ) : searchQuery ? (
              <div className="rounded-xl border border-stone-200 bg-white py-12 text-center shadow-sm">
                <p className="text-[13px] text-stone-500">未找到未导入的新技能</p>
              </div>
            ) : null}

            {importedSkills.length > 0 && (
              <SkillGroup title="已在本地的重复技能" count={importedSkills.length} defaultExpanded={false}>
                <div className="space-y-2">
                  {importedSkills.map(({ skill, toolName }) => (
                    <DiscoverSkillCard
                      key={importKeyFor(skill)}
                      skill={skill}
                      toolName={toolName}
                      importing={false}
                      onImport={onImport}
                    />
                  ))}
                </div>
              </SkillGroup>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/70 px-8 py-12 text-center shadow-none">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
              <FolderIcon className="h-6 w-6 text-stone-500" />
            </div>
            <h3 className="mt-5 text-[15px] font-semibold text-stone-900">
              未发现可导入的技能
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-stone-500">
              请先在 Claude Code 等工具中安装技能后重试。
            </p>
          </div>
        )
      ) : (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/70 px-8 py-12 text-center shadow-none">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
            <SparkIcon className="h-6 w-6 text-stone-500" />
          </div>
          <h3 className="mt-5 text-[15px] font-semibold text-stone-900">
            准备扫描
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-stone-500">
            Zora 可以自动发现本机其他 AI 工具中的技能并导入。
          </p>
        </div>
      )}
    </div>
  );
}

export function SkillManagerPanel() {
  const skills = useAtomValue(skillsAtom);
  const loadSkills = useSetAtom(loadSkillsAtom);

  const [tab, setTab] = useState<TabId>("installed");
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [uninstallingDirName, setUninstallingDirName] = useState<string | null>(null);
  const [importingSet, setImportingSet] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice>(null);

  const refreshInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      await loadSkills();
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setLoadingInstalled(false);
    }
  }, [loadSkills]);

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

  useEffect(() => {
    void refreshInstalled();
    void handleScan();
  }, [refreshInstalled, handleScan]);

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
      setNotice(null);

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
      setNotice(null);

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

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <GlobalToast notice={notice} onClose={() => setNotice(null)} />

      <div className="mb-5 inline-flex rounded-[14px] border-none bg-stone-100/50 p-1 shadow-none">
        <button
          type="button"
          onClick={() => setTab("installed")}
          className={cn(
            "rounded-[14px] px-4 py-2 text-[13px] font-medium transition",
            tab === "installed"
              ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
              : "text-stone-500 hover:text-stone-800"
          )}
        >
          已安装 ({skills.length})
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
            "rounded-[14px] px-4 py-2 text-[13px] font-medium transition",
            tab === "discover"
              ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
              : "text-stone-500 hover:text-stone-800"
          )}
        >
          发现 {loadingDiscovery ? "(...)" : discoveryResult ? `(${discoveryResult.totalNew})` : ""}
        </button>
      </div>

      {tab === "installed" ? (
        <InstalledTab
          skills={skills}
          loading={loadingInstalled}
          uninstallingDirName={uninstallingDirName}
          onRefresh={() => {
            void refreshInstalled();
          }}
          onUninstall={(dirName) => {
            void handleUninstall(dirName);
          }}
          onOpenDir={(dirName) => {
            void handleOpenDir(dirName);
          }}
          onOpenSkillsDir={() => {
            void handleOpenSkillsDir();
          }}
        />
      ) : (
        <DiscoverTab
          result={discoveryResult}
          loading={loadingDiscovery}
          importingSet={importingSet}
          onScan={() => {
            void handleScan();
          }}
          onImport={(skill, method) => {
            void handleImport(skill, method);
          }}
        />
      )}
    </section>
  );
}
