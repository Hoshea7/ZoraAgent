import { useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ProviderConfig } from "../../../shared/types/provider";
import type { VisionSettings as VisionSettingsValue } from "../../../shared/types/vision";
import { loadProvidersAtom, providersAtom } from "../../store/provider";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { getProviderModels } from "../../utils/provider-selection";

type VisionTarget = {
  provider: ProviderConfig;
  modelId: string;
  modelLabel: string;
};

function getVisionTargets(providers: ProviderConfig[]): VisionTarget[] {
  return providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      getProviderModels(provider).map((model) => ({
        provider,
        modelId: model.modelId,
        modelLabel: model.label,
      }))
    );
}

function formatTarget(target: VisionTarget | undefined): string {
  return target
    ? `${target.provider.name} · ${target.modelId}`
    : "暂无可用模型";
}

export function VisionSettings() {
  const providers = useAtomValue(providersAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const [settings, setSettings] = useState<VisionSettingsValue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    void Promise.all([
      window.zora.vision.getSettings(),
      loadProviders(),
    ])
      .then(([loadedSettings]) => {
        if (isActive) {
          setSettings(loadedSettings);
        }
      })
      .catch((error: unknown) => {
        if (isActive) setErrorMessage(getErrorMessage(error));
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [loadProviders]);

  const targets = useMemo(() => getVisionTargets(providers), [providers]);
  const selectedTarget = settings?.relay.enabled
    ? targets.find(
        (target) =>
          target.provider.id === settings.relay.providerId &&
          target.modelId === settings.relay.modelId
      )
    : undefined;
  const visibleTarget = selectedTarget ?? targets[0];

  const save = async (next: VisionSettingsValue) => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      setSettings(await window.zora.vision.updateSettings(next));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const setRelayEnabled = (enabled: boolean) => {
    if (!settings) return;
    if (!enabled) {
      void save({ ...settings, relay: { enabled: false } });
      return;
    }
    if (!visibleTarget) return;
    void save({
      ...settings,
      relay: {
        enabled: true,
        providerId: visibleTarget.provider.id,
        modelId: visibleTarget.modelId,
      },
    });
  };

  const selectTarget = (target: VisionTarget) => {
    if (!settings) return;
    void save({
      ...settings,
      relay: {
        enabled: true,
        providerId: target.provider.id,
        modelId: target.modelId,
      },
    });
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 w-full pb-12 duration-500">
      <div className="mb-7">
        <h2 className="text-[20px] font-semibold tracking-tight text-stone-900">
          视觉助手
        </h2>
        <p className="mt-1.5 text-[13px] leading-5 text-stone-400">
          为不支持图片的 Agent 选择一个独立视觉模型。
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200/70 bg-white shadow-sm shadow-stone-100/60">
        <div className="flex min-h-[72px] items-center justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-stone-800">启用视觉中转</div>
            <p className="mt-0.5 text-[12px] leading-5 text-stone-400">
              Agent 需要理解会话图片时使用视觉模型。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="启用视觉中转"
            aria-checked={settings?.relay.enabled ?? false}
            disabled={isLoading || isSaving || !settings || targets.length === 0}
            onClick={() => setRelayEnabled(!settings?.relay.enabled)}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
              "focus:outline-none focus:ring-2 focus:ring-stone-300/50 focus:ring-offset-2",
              settings?.relay.enabled ? "bg-stone-900" : "bg-stone-200",
              "disabled:cursor-not-allowed disabled:opacity-45"
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                settings?.relay.enabled ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        <div className="h-px bg-stone-100" />

        <div className="flex min-h-[72px] items-center justify-between gap-6 px-5 py-4">
          <div className="min-w-0 shrink-0">
            <div className="text-[13px] font-medium text-stone-800">选择视觉模型</div>
            <p className="mt-0.5 text-[12px] leading-5 text-stone-400">
              使用模型配置中已保存的 Provider 和 API Key。
            </p>
          </div>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="选择视觉模型"
                disabled={isLoading || isSaving || !settings || targets.length === 0}
                className={cn(
                  "flex min-w-0 max-w-[360px] flex-1 items-center justify-end gap-2 rounded-lg px-3 py-2",
                  "text-[13px] text-stone-700 transition-colors hover:bg-stone-50",
                  "focus:outline-none focus:ring-2 focus:ring-stone-200/60",
                  "disabled:cursor-not-allowed disabled:text-stone-400"
                )}
              >
                <span className="truncate">{formatTarget(visibleTarget)}</span>
                <svg
                  className="h-3.5 w-3.5 shrink-0 text-stone-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="bottom"
                align="end"
                className="z-50 max-h-72 min-w-[320px] overflow-y-auto rounded-lg border border-stone-200/70 bg-white py-1 shadow-lg shadow-stone-200/50"
              >
                {providers
                  .filter((provider) => provider.enabled)
                  .map((provider, providerIndex) => {
                    const models = targets.filter(
                      (target) => target.provider.id === provider.id
                    );
                    if (models.length === 0) return null;
                    return (
                      <div key={provider.id}>
                        {providerIndex > 0 ? <div className="border-t border-stone-100" /> : null}
                        <div className="bg-stone-50/80 px-3 py-1.5 text-[11px] font-medium text-stone-500">
                          {provider.name}
                        </div>
                        {models.map((target) => (
                          <DropdownMenu.Item
                            key={`${provider.id}:${target.modelId}`}
                            className="cursor-pointer px-4 py-2 text-[13px] text-stone-600 outline-none data-[highlighted]:bg-stone-50"
                            onSelect={() => selectTarget(target)}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate">{target.modelId}</span>
                              {target.modelLabel ? (
                                <span className="shrink-0 text-[11px] text-stone-400">
                                  {target.modelLabel}
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
      </div>

      {errorMessage ? (
        <p className="mt-3 text-[12px] text-rose-600">{errorMessage}</p>
      ) : null}
    </section>
  );
}
