import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { MemorySettings as MemorySettingsValue } from "../../../shared/types/memory";
import type { ProviderConfig } from "../../../shared/types/provider";
import { loadProvidersAtom, providersAtom } from "../../store/provider";
import { cn } from "../../utils/cn";
import { emitMemorySettingsUpdated } from "../../utils/memory-settings-event";
import { getErrorMessage } from "../../utils/message";
import {
  getProviderModels,
  normalizeOptionalModelId,
  resolveActiveProvider,
  resolveSelectedModelId,
} from "../../utils/provider-selection";
import { Button } from "../ui/Button";

const BATCH_IDLE_OPTIONS = [1, 10, 20, 30, 60, 120] as const;
const MEMORY_MODE_OPTIONS = [
  {
    value: "immediate",
    title: "即时记忆",
    description: "每次对话结束后立即处理记忆",
  },
  {
    value: "batch",
    title: "批量记忆",
    description: "累积多次对话后统一处理，减少 token 消耗",
  },
  {
    value: "manual",
    title: "手动记忆",
    description: "仅在对话中说“记住这个”或手动触发时处理",
  },
] as const satisfies ReadonlyArray<{
  value: MemorySettingsValue["mode"];
  title: string;
  description: string;
}>;

type SaveState = "idle" | "saving" | "saved";

type MemoryModelUiState = {
  triggerLabel: string;
  helperText: string;
  normalizationPatch: Partial<MemorySettingsValue> | null;
};

function formatProviderModelText(
  provider: ProviderConfig | null,
  modelId?: string | null
): string {
  if (!provider) {
    return "暂无可用模型";
  }

  const normalizedModelId = normalizeOptionalModelId(modelId);
  return normalizedModelId ? `${provider.name} · ${normalizedModelId}` : provider.name;
}

function hasSettingsDifference(
  settings: MemorySettingsValue,
  patch: Partial<MemorySettingsValue>
): boolean {
  if (patch.mode !== undefined && patch.mode !== settings.mode) {
    return true;
  }

  if (
    patch.batchIdleMinutes !== undefined &&
    patch.batchIdleMinutes !== settings.batchIdleMinutes
  ) {
    return true;
  }

  if (
    patch.memoryProviderId !== undefined &&
    patch.memoryProviderId !== settings.memoryProviderId
  ) {
    return true;
  }

  if (
    patch.memoryModelId !== undefined &&
    patch.memoryModelId !== settings.memoryModelId
  ) {
    return true;
  }

  return false;
}

function createMemoryModelSelectionPatch(
  provider: ProviderConfig,
  modelId: string
): Partial<MemorySettingsValue> {
  const providerDefaultModelId = normalizeOptionalModelId(provider.modelId);

  return {
    memoryProviderId: provider.id,
    memoryModelId: providerDefaultModelId === modelId ? null : modelId,
  };
}

function buildMemoryModelUiState(
  settings: MemorySettingsValue,
  providers: ProviderConfig[]
): MemoryModelUiState {
  const fallbackProvider = resolveActiveProvider(providers);
  const fallbackModelId = resolveSelectedModelId(fallbackProvider);
  const fallbackText = formatProviderModelText(fallbackProvider, fallbackModelId);

  if (!settings.memoryProviderId) {
    return {
      triggerLabel: "跟随默认模型",
      helperText: fallbackProvider
        ? `当前生效：${fallbackText}`
        : "当前暂无可用的默认模型配置",
      normalizationPatch:
        settings.memoryModelId === null ? null : { memoryModelId: null },
    };
  }

  const provider = providers.find((item) => item.id === settings.memoryProviderId);
  if (!provider) {
    return {
      triggerLabel: "跟随默认模型",
      helperText: fallbackProvider
        ? `原记忆模型配置已失效，当前回退到：${fallbackText}`
        : "原记忆模型配置已失效，当前暂无可用模型",
      normalizationPatch: {
        memoryProviderId: null,
        memoryModelId: null,
      },
    };
  }

  const providerDefaultModelId = normalizeOptionalModelId(provider.modelId) ?? null;
  const requestedModelId = normalizeOptionalModelId(settings.memoryModelId) ?? null;
  const availableModels = getProviderModels(provider);
  const availableModelIds = new Set(availableModels.map((model) => model.modelId));
  const effectiveModelId = resolveSelectedModelId(provider, requestedModelId ?? undefined) ?? null;
  const providerLabel = formatProviderModelText(provider, effectiveModelId);

  if (!provider.enabled) {
    return {
      triggerLabel: requestedModelId ?? `跟随 ${provider.name} 默认模型`,
      helperText: fallbackProvider
        ? `专用 Provider 已停用，运行时会回退到：${fallbackText}`
        : "专用 Provider 已停用，当前暂无可用模型",
      normalizationPatch: null,
    };
  }

  if (requestedModelId && providerDefaultModelId && requestedModelId === providerDefaultModelId) {
    return {
      triggerLabel: `跟随 ${provider.name} 默认模型`,
      helperText: `当前生效：${providerLabel}`,
      normalizationPatch: {
        memoryModelId: null,
      },
    };
  }

  if (!requestedModelId) {
    return {
      triggerLabel: `跟随 ${provider.name} 默认模型`,
      helperText: effectiveModelId
        ? `当前生效：${providerLabel}`
        : `当前使用 ${provider.name} 的默认配置`,
      normalizationPatch: null,
    };
  }

  if (!availableModelIds.has(requestedModelId)) {
    return {
      triggerLabel: effectiveModelId ?? requestedModelId,
      helperText: effectiveModelId
        ? `原模型已不可用，当前回退到：${providerLabel}`
        : `原模型已不可用，当前使用 ${provider.name} 的默认配置`,
      normalizationPatch: {
        memoryModelId: providerDefaultModelId ? null : effectiveModelId,
      },
    };
  }

  return {
    triggerLabel: requestedModelId,
    helperText: `当前固定：${providerLabel}`,
    normalizationPatch: null,
  };
}

export function MemorySettings() {
  const providers = useAtomValue(providersAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const [settings, setSettings] = useState<MemorySettingsValue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedProviders, setHasLoadedProviders] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestRequestRef = useRef(0);
  const lastAutoPatchSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadData = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [loadedSettings] = await Promise.all([
          window.zora.memory.getSettings(),
          loadProviders(),
        ]);

        if (!isActive) {
          return;
        }

        setSettings(loadedSettings);
        setHasLoadedProviders(true);
        emitMemorySettingsUpdated(loadedSettings);
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
          emitMemorySettingsUpdated(updatedSettings);
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
            emitMemorySettingsUpdated(latestSettings);
          }
        } catch {
          // Keep the visible error and optimistic state when reload also fails.
        }
      });
  };

  useEffect(() => {
    if (isLoading || !hasLoadedProviders || !settings) {
      lastAutoPatchSignatureRef.current = null;
      return;
    }

    const normalizationPatch = buildMemoryModelUiState(
      settings,
      providers
    ).normalizationPatch;

    if (!normalizationPatch || !hasSettingsDifference(settings, normalizationPatch)) {
      lastAutoPatchSignatureRef.current = null;
      return;
    }

    const patchSignature = JSON.stringify(normalizationPatch);
    if (lastAutoPatchSignatureRef.current === patchSignature) {
      return;
    }

    lastAutoPatchSignatureRef.current = patchSignature;
    queueSettingsUpdate(normalizationPatch);
  }, [hasLoadedProviders, isLoading, providers, settings]);

  const handleRetry = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [loadedSettings] = await Promise.all([
        window.zora.memory.getSettings(),
        loadProviders(),
      ]);
      setSettings(loadedSettings);
      setHasLoadedProviders(true);
      emitMemorySettingsUpdated(loadedSettings);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const enabledProviders = providers.filter((provider) => provider.enabled);
  const memoryModelUiState = settings
    ? buildMemoryModelUiState(settings, providers)
    : null;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 w-full pb-12 duration-500">
      {/* 保存状态 */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] text-stone-400">
          {settings?.mode === "immediate" ? "即时记忆" : settings?.mode === "batch" ? "批量记忆" : "手动记忆"}
        </span>
        <span className="text-[12px] text-stone-400">
          {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : null}
        </span>
      </div>

      {errorMessage ? (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-rose-200/60 bg-rose-50/80 px-4 py-2.5 text-[13px] text-rose-600">
          <p className="leading-relaxed">{errorMessage}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-3 text-[12px]"
            onClick={() => void handleRetry()}
          >
            重试
          </Button>
        </div>
      ) : null}

      {isLoading || !hasLoadedProviders || !settings ? (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
          <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
          <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
          <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
          <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
        </div>
      ) : (
        <>
          {/* 记忆模式选项 */}
          <div className="space-y-1">
            {MEMORY_MODE_OPTIONS.map((option) => {
              const isActive = settings.mode === option.value;

              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150",
                    isActive ? "bg-stone-100/60" : "hover:bg-stone-50"
                  )}
                >
                  <input
                    type="radio"
                    name="memory-mode"
                    className="h-3.5 w-3.5 border-stone-300 text-stone-600 focus:ring-stone-300"
                    checked={isActive}
                    onChange={() => queueSettingsUpdate({ mode: option.value })}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-stone-700">
                      {option.title}
                    </span>
                    <span className="ml-2 text-[12px] text-stone-400">
                      {option.description}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          {/* 批量模式设置 */}
          {settings.mode === "batch" && (
            <div className="mt-3 flex items-center gap-3">
              <span className="w-20 shrink-0 text-[12px] text-stone-500">空闲等待</span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className={cn(
                      "flex flex-1 items-center justify-between rounded-lg bg-stone-50/60 px-3 py-1.5",
                      "text-[13px] text-stone-700 transition-all hover:bg-stone-100/80",
                      "focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                    )}
                  >
                    <span>{settings.batchIdleMinutes} 分钟</span>
                    <svg className="h-3.5 w-3.5 text-stone-400 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="bottom"
                    align="start"
                    className="z-50 rounded-lg border border-stone-200/60 bg-white py-1 shadow-lg shadow-stone-200/50"
                  >
                    {BATCH_IDLE_OPTIONS.map((minutes) => (
                      <DropdownMenu.Item
                        key={minutes}
                        className="cursor-pointer px-3 py-2 text-[13px] text-stone-600 outline-none hover:bg-stone-50 data-[highlighted]:bg-stone-50"
                        onSelect={() => queueSettingsUpdate({ batchIdleMinutes: minutes })}
                      >
                        {minutes} 分钟
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          )}

          {/* 记忆模型选择 */}
          <div className="mt-3 flex items-center gap-3">
            <span className="w-20 shrink-0 text-[13px] text-stone-500">记忆模型</span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className={cn(
                    "flex flex-1 items-center justify-between rounded-lg bg-stone-50/60 px-3 py-1.5",
                    "text-[13px] text-stone-700 transition-all hover:bg-stone-100/80",
                    "focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                  )}
                >
                  <span className="truncate">
                    {memoryModelUiState?.triggerLabel ?? "跟随默认模型"}
                  </span>
                  <svg className="h-3.5 w-3.5 text-stone-400 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="bottom"
                  align="start"
                  className="z-50 max-h-64 overflow-y-auto rounded-lg border border-stone-200/60 bg-white shadow-lg shadow-stone-200/50"
                  style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}
                >
                  <DropdownMenu.Item
                    className="border-b border-stone-100 cursor-pointer px-3 py-2.5 text-[13px] text-stone-600 outline-none hover:bg-stone-50 data-[highlighted]:bg-stone-50"
                    onSelect={() => queueSettingsUpdate({ memoryProviderId: null, memoryModelId: null })}
                  >
                    跟随默认模型
                  </DropdownMenu.Item>
                  {enabledProviders.map((provider, providerIndex) => {
                    const models = getProviderModels(provider);
                    if (models.length === 0) return null;
                    return (
                      <div key={provider.id}>
                        {providerIndex > 0 && <div className="border-t border-stone-100" />}
                        <div className="bg-stone-50/80 px-3 py-1.5 text-[11px] text-stone-500 font-medium">
                          {provider.name}
                        </div>
                        {models.map((model) => (
                          <DropdownMenu.Item
                            key={`${provider.id}:${model.modelId}`}
                            className="cursor-pointer px-4 py-2 text-[13px] text-stone-600 outline-none hover:bg-stone-50 data-[highlighted]:bg-stone-50"
                            onSelect={() =>
                              queueSettingsUpdate(
                                createMemoryModelSelectionPatch(provider, model.modelId)
                              )
                            }
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-stone-400">
                                {normalizeOptionalModelId(provider.modelId) === model.modelId
                                  ? "默认"
                                  : "·"}
                              </span>
                              <span className="truncate">{model.modelId}</span>
                              {model.label ? (
                                <span className="text-[11px] text-stone-400">
                                  {model.label}
                                </span>
                              ) : null}
                            </div>
                          </DropdownMenu.Item>
                        ))}
                      </div>
                    );
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          <p className="text-[11px] text-stone-400">
            {memoryModelUiState?.helperText}
          </p>
          <p className="text-[11px] text-stone-400">
            记忆处理不需要最强模型，配置低成本模型可大幅节省开支
          </p>
        </>
      )}
    </section>
  );
}
