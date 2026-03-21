import { useEffect, useRef, useState } from "react";
import type { MemorySettings as MemorySettingsValue } from "../../../shared/types/memory";
import type { ProviderConfig } from "../../../shared/types/provider";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";

const BATCH_IDLE_OPTIONS = [1, 10, 20, 30, 60, 120] as const;
const MEMORY_MODE_OPTIONS = [
  {
    value: "immediate",
    title: "即时记忆",
    description: "每次对话结束后立即处理记忆",
    recommended: false,
  },
  {
    value: "batch",
    title: "批量记忆",
    description: "累积多次对话后统一处理，减少 token 消耗",
    recommended: true,
  },
  {
    value: "manual",
    title: "手动记忆",
    description: "仅在对话中说“记住这个”或手动触发时处理",
    recommended: false,
  },
] as const satisfies ReadonlyArray<{
  value: MemorySettingsValue["mode"];
  title: string;
  description: string;
  recommended?: boolean;
}>;

type SaveState = "idle" | "saving" | "saved";

const sectionLabelClassName =
  "text-[12px] font-medium uppercase tracking-[0.08em] text-stone-500";
const selectClassName = [
  "w-full appearance-none rounded-[14px] border border-stone-200 bg-white px-4 py-3",
  "text-[14px] text-stone-900 outline-none transition-all",
  "focus:border-stone-400 focus:ring-4 focus:ring-stone-200/60",
].join(" ");

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className={sectionLabelClassName}>{title}</h3>
      <div className="h-px flex-1 bg-stone-100" />
    </div>
  );
}

function SelectChevron() {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-stone-400">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </div>
  );
}

export function MemorySettings() {
  const [settings, setSettings] = useState<MemorySettingsValue | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestRequestRef = useRef(0);

  useEffect(() => {
    let isActive = true;

    const loadData = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [loadedSettings, loadedProviders] = await Promise.all([
          window.zora.memory.getSettings(),
          window.zora.listProviders(),
        ]);

        if (!isActive) {
          return;
        }

        setSettings(loadedSettings);
        setProviders(loadedProviders);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setErrorMessage(getErrorMessage(error));
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (saveState !== "saved") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSaveState("idle");
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [saveState]);

  const queueSettingsUpdate = (patch: Partial<MemorySettingsValue>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setSaveState("saving");
    setErrorMessage(null);

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;

    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const updatedSettings = await window.zora.memory.updateSettings(patch);

        if (requestId === latestRequestRef.current) {
          setSettings(updatedSettings);
          setSaveState("saved");
        }
      })
      .catch(async (error: unknown) => {
        if (requestId !== latestRequestRef.current) {
          return;
        }

        setSaveState("idle");
        setErrorMessage(getErrorMessage(error));

        try {
          const latestSettings = await window.zora.memory.getSettings();
          if (requestId === latestRequestRef.current) {
            setSettings(latestSettings);
          }
        } catch {
          // Keep the visible error and optimistic state when reload also fails.
        }
      });
  };

  const handleRetry = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [loadedSettings, loadedProviders] = await Promise.all([
        window.zora.memory.getSettings(),
        window.zora.listProviders(),
      ]);
      setSettings(loadedSettings);
      setProviders(loadedProviders);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 w-full space-y-8 pb-12 duration-500">
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-5">
          <div>
            <h2 className="text-[28px] font-bold tracking-tight text-stone-900">记忆</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-stone-400">
              管理 Zora 的记忆处理方式和模型配置
            </p>
          </div>

          <div className="pt-1 text-[12px] font-medium text-stone-400">
            {saveState === "saving" ? "正在保存…" : null}
            {saveState === "saved" ? "已自动保存" : null}
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="flex items-center justify-between gap-4 rounded-[16px] border border-rose-200 bg-rose-50/80 px-4 py-3 text-[13px] text-rose-700">
          <p className="leading-relaxed">{errorMessage}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0 px-3 py-1.5 text-[12px]"
            onClick={() => void handleRetry()}
          >
            重试
          </Button>
        </div>
      ) : null}

      {isLoading || !settings ? (
        <div className="space-y-5">
          <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] ring-1 ring-stone-900/5">
            <div className="space-y-3 px-5 py-5">
              <div className="h-4 w-24 animate-pulse rounded bg-stone-100" />
              <div className="h-16 animate-pulse rounded-[14px] bg-stone-50" />
              <div className="h-16 animate-pulse rounded-[14px] bg-stone-50" />
              <div className="h-16 animate-pulse rounded-[14px] bg-stone-50" />
            </div>
          </div>
          <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] ring-1 ring-stone-900/5">
            <div className="space-y-3 px-5 py-5">
              <div className="h-4 w-24 animate-pulse rounded bg-stone-100" />
              <div className="h-12 animate-pulse rounded-[14px] bg-stone-50" />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <SectionHeading title="记忆模式" />

            <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] ring-1 ring-stone-900/5">
              {MEMORY_MODE_OPTIONS.map((option, index) => {
                const isActive = settings.mode === option.value;

                return (
                  <label
                    key={option.value}
                    className={cn(
                      "relative flex cursor-pointer items-start gap-3 px-5 py-4 transition-all duration-200",
                      isActive ? "bg-stone-50/80" : "hover:bg-stone-50/40"
                    )}
                  >
                    <input
                      type="radio"
                      name="memory-mode"
                      className="mt-1 h-4 w-4 border-stone-300 text-stone-900 focus:ring-stone-300"
                      checked={isActive}
                      onChange={() => queueSettingsUpdate({ mode: option.value })}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium text-stone-900">
                          {option.title}
                        </span>
                        {option.recommended ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-medium tracking-[0.06em] text-amber-700">
                            推荐
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-stone-500">
                        {option.description}
                      </p>
                    </div>

                    {index < MEMORY_MODE_OPTIONS.length - 1 ? (
                      <div className="absolute inset-x-5 bottom-0 h-px bg-stone-100/80" />
                    ) : null}
                  </label>
                );
              })}
            </div>

            {settings.mode === "batch" ? (
              <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/70 px-5 py-4">
                <label className="block">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[14px] font-medium text-stone-900">空闲等待时间</span>
                    <span className="text-[12px] text-stone-400">仅批量模式生效</span>
                  </div>

                  <div className="relative">
                    <select
                      className={cn(selectClassName, "pr-10")}
                      value={String(settings.batchIdleMinutes)}
                      onChange={(event) =>
                        queueSettingsUpdate({
                          batchIdleMinutes: Number(event.target.value),
                        })
                      }
                    >
                      {BATCH_IDLE_OPTIONS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} 分钟
                        </option>
                      ))}
                    </select>
                    <SelectChevron />
                  </div>
                </label>

                <p className="mt-2 text-[12.5px] leading-relaxed text-stone-400">
                  最后一次对话结束后等待该时间无新对话，即触发批量处理
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <SectionHeading title="记忆模型" />

            <div className="rounded-[18px] bg-white px-5 py-5 shadow-[0_2px_12px_rgba(0,0,0,0.03)] ring-1 ring-stone-900/5">
              <label className="block">
                <span className="mb-2 block text-[14px] font-medium text-stone-900">
                  记忆处理模型
                </span>

                <div className="relative">
                  <select
                    className={cn(selectClassName, "pr-10")}
                    value={settings.memoryProviderId ?? ""}
                    onChange={(event) =>
                      queueSettingsUpdate({
                        memoryProviderId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">跟随默认模型</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                        {provider.modelId ? ` - ${provider.modelId}` : ""}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              </label>

              <p className="mt-2 text-[12.5px] leading-relaxed text-stone-400">
                记忆处理不需要最强模型，配置低成本模型可大幅节省开支
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
