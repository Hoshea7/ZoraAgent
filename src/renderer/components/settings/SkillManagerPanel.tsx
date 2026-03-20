import { useCallback, useEffect, useState } from "react";
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

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3.75 7.5a1.5 1.5 0 011.5-1.5h4.01a1.5 1.5 0 011.11.49l.9 1.01h7.48a1.5 1.5 0 011.5 1.5v7.5a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-9z"
      />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M13 3l-1.8 4.6L6.6 9.4l4.6 1.8L13 16l1.8-4.8 4.6-1.8-4.6-1.8L13 3z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) {
    return null;
  }

  return (
    <div
      className={cn(
        "mb-5 rounded-2xl border px-4 py-3 text-[13px] shadow-sm",
        notice.tone === "success"
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-700"
          : "border-rose-200 bg-rose-50/80 text-rose-700"
      )}
    >
      {notice.message}
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
  const [confirming, setConfirming] = useState(false);

  return (
    <article className="flex items-start justify-between gap-4 rounded-[18px] border border-stone-200 bg-white px-4 py-4 shadow-sm shadow-stone-950/5 transition hover:border-stone-300 hover:bg-stone-50/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold text-stone-900">
            {skill.name}
          </h3>
          <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-stone-500">
            {skill.dirName}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-stone-500">
          {skill.description}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenDir(skill.dirName)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-stone-300 hover:bg-stone-100 hover:text-stone-900"
          title="打开 Skill 目录"
        >
          <FolderIcon className="h-4 w-4" />
        </button>

        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={uninstalling}
              onClick={() => {
                onUninstall(skill.dirName);
                setConfirming(false);
              }}
              className="rounded-full bg-rose-600 px-3 py-2 text-[12px] font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={uninstalling}
              onClick={() => setConfirming(false)}
              className="rounded-full border border-stone-200 bg-white px-3 py-2 text-[12px] font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={uninstalling}
            onClick={() => setConfirming(true)}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uninstalling ? "Removing..." : "Uninstall"}
          </button>
        )}
      </div>
    </article>
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
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[18px] border border-stone-200 bg-gradient-to-br from-stone-50 to-stone-100/60 px-4 py-4 shadow-sm shadow-stone-950/5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-stone-500">
            Installed Skills
          </p>
          <p className="mt-1 text-[14px] text-stone-600">
            {skills.length} skill{skills.length !== 1 ? "s" : ""} currently active in
            Zora.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onOpenSkillsDir}>
            Open Folder
          </Button>
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>

      {skills.length === 0 && !loading ? (
        <div className="rounded-[22px] border border-dashed border-stone-300 bg-stone-50/70 px-8 py-12 text-center shadow-sm shadow-stone-950/5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
            <SparkIcon className="h-6 w-6 text-stone-500" />
          </div>
          <h3 className="mt-5 text-[16px] font-semibold text-stone-900">
            No skills installed yet
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6 text-stone-500">
            Switch to Discover to import skills from other AI tools, or ask Zora to
            install a new skill into your local library.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <InstalledSkillCard
              key={skill.dirName}
              skill={skill}
              uninstalling={uninstallingDirName === skill.dirName}
              onUninstall={onUninstall}
              onOpenDir={onOpenDir}
            />
          ))}
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
  importing,
  onImport,
}: {
  skill: DiscoveredSkill;
  importing: boolean;
  onImport: (skill: DiscoveredSkill, method: ImportMethod) => void;
}) {
  const [showMethodPicker, setShowMethodPicker] = useState(false);

  if (skill.alreadyInZora) {
    return (
      <article className="flex items-start justify-between gap-4 rounded-[18px] border border-stone-200 bg-stone-50/70 px-4 py-4 text-stone-500">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-stone-700">
            {skill.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-stone-500">
            {skill.description}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          <CheckIcon className="h-3.5 w-3.5" />
          Imported
        </span>
      </article>
    );
  }

  return (
    <article className="flex items-start justify-between gap-4 rounded-[18px] border border-stone-200 bg-white px-4 py-4 shadow-sm shadow-stone-950/5 transition hover:border-stone-300 hover:bg-stone-50/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold text-stone-900">
            {skill.name}
          </h3>
          <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-stone-500">
            {skill.dirName}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-stone-500">
          {skill.description}
        </p>
      </div>

      {showMethodPicker ? (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={importing}
            onClick={() => {
              onImport(skill, "symlink");
              setShowMethodPicker(false);
            }}
            className="rounded-full border border-stone-200 bg-white px-3 py-2 text-[12px] font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Create a symlink that stays in sync with the original source"
          >
            Symlink
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={() => {
              onImport(skill, "copy");
              setShowMethodPicker(false);
            }}
            className="rounded-full border border-stone-200 bg-white px-3 py-2 text-[12px] font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Copy the files into Zora for a fully independent local version"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => setShowMethodPicker(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
            title="Cancel"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <Button
          variant="primary"
          size="sm"
          disabled={importing}
          onClick={() => setShowMethodPicker(true)}
          className="shrink-0"
        >
          {importing ? "Importing..." : "Import"}
        </Button>
      )}
    </article>
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
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[18px] border border-stone-200 bg-gradient-to-br from-stone-50 to-stone-100/60 px-4 py-4 shadow-sm shadow-stone-950/5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-stone-500">
            Discover Skills
          </p>
          <p className="mt-1 text-[14px] text-stone-600">
            {result
              ? `${result.totalNew} new skill${result.totalNew !== 1 ? "s" : ""} available to import`
              : "Scan supported tools to find reusable skills"}
          </p>
        </div>

        <Button variant="primary" size="sm" onClick={onScan} disabled={loading}>
          {loading ? "Scanning..." : "Scan"}
        </Button>
      </div>

      {result ? (
        result.tools.some((toolGroup) => toolGroup.exists && toolGroup.skills.length > 0) ? (
          <div className="space-y-6">
            {result.tools.map((toolGroup) => {
              if (!toolGroup.exists || toolGroup.skills.length === 0) {
                return null;
              }

              return (
                <section key={toolGroup.tool.id} className="space-y-3">
                  <div className="flex items-end justify-between gap-3 border-b border-stone-100 pb-2">
                    <div>
                      <h3 className="text-[15px] font-semibold text-stone-900">
                        {toolGroup.tool.name}
                      </h3>
                      <p className="mt-1 text-[12px] text-stone-500">
                        {toolGroup.skills.length} skill
                        {toolGroup.skills.length !== 1 ? "s" : ""} found
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {toolGroup.skills.map((skill) => (
                      <DiscoverSkillCard
                        key={`${toolGroup.tool.id}-${skill.dirName}`}
                        skill={skill}
                        importing={importingSet.has(importKeyFor(skill))}
                        onImport={onImport}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[22px] border border-dashed border-stone-300 bg-stone-50/70 px-8 py-12 text-center shadow-sm shadow-stone-950/5">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
              <FolderIcon className="h-6 w-6 text-stone-500" />
            </div>
            <h3 className="mt-5 text-[16px] font-semibold text-stone-900">
              No external skills found
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6 text-stone-500">
              Install some skills in Claude Code, Codex, Gemini CLI, or other
              supported tools first, then scan again here.
            </p>
          </div>
        )
      ) : (
        <div className="rounded-[22px] border border-dashed border-stone-300 bg-stone-50/70 px-8 py-12 text-center shadow-sm shadow-stone-950/5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
            <SparkIcon className="h-6 w-6 text-stone-500" />
          </div>
          <h3 className="mt-5 text-[16px] font-semibold text-stone-900">
            Ready to scan
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6 text-stone-500">
            Zora can discover skills from your other AI tooling and import them by
            symlink or copy.
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
      setNotice(null);

      try {
        await window.zora.uninstallSkill(dirName);
        await refreshInstalled();
        if (discoveryResult) {
          await handleScan();
        }
        setNotice({ tone: "success", message: `Removed "${dirName}" from Zora.` });
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
            message: result.error ?? `Failed to import "${skill.name}".`,
          });
          return;
        }

        await refreshInstalled();
        await handleScan();
        setNotice({
          tone: "success",
          message: `Imported "${skill.name}" via ${method}.`,
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
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex flex-col gap-1.5 border-b border-stone-100 pb-5">
        <h2 className="text-[24px] font-semibold tracking-tight text-stone-900">
          Skills
        </h2>
        <p className="text-[14px] leading-relaxed text-stone-500">
          Manage the skills available to Zora, remove ones you no longer need,
          and import reusable skills from your other AI tools.
        </p>
      </div>

      <div className="mb-5 inline-flex rounded-2xl border border-stone-200 bg-stone-50 p-1 shadow-sm shadow-stone-950/5">
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
          Installed
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
          Discover
        </button>
      </div>

      <NoticeBanner notice={notice} />

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
