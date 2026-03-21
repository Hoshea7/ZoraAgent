import { useState, type ReactElement } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { loadProvidersAtom, providersAtom } from "../../store/provider";
import {
  currentSessionAtom,
  draftSelectedModelIdAtom,
  setDraftSelectedModelIdAtom,
  updateSessionMetaInStateAtom,
} from "../../store/workspace";
import { PROVIDER_PRESETS, type ProviderConfig } from "../../../shared/types/provider";
import {
  getProviderModels,
  resolveActiveProvider,
  resolveCurrentProviderAndModel,
  resolveLockedProvider,
  resolveSelectedModelId,
  resolveSelectedModelOverride,
} from "../../utils/provider-selection";
import { cn } from "../../utils/cn";

export interface ModelSelectorProps {
  trigger: ReactElement;
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="6" y="11" width="12" height="9" rx="2" />
      <path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" />
    </svg>
  );
}

export function ModelSelector({ trigger }: ModelSelectorProps) {
  const providers = useAtomValue(providersAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const setDraftSelectedModelId = useSetAtom(setDraftSelectedModelIdAtom);
  const updateSessionMetaInState = useSetAtom(updateSessionMetaInStateAtom);
  const [open, setOpen] = useState(false);
  const [pendingSelectionKey, setPendingSelectionKey] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const activeProvider = resolveActiveProvider(providers);
  const lockedProvider = resolveLockedProvider(providers, currentSession);
  const {
    provider: currentProvider,
    modelId: currentModelId,
    isLocked,
    isMissingLockedProvider,
  } = resolveCurrentProviderAndModel(providers, currentSession, draftSelectedModelId);

  const handleSelectModel = async (
    provider: ProviderConfig,
    requestedModelId?: string
  ) => {
    if (currentSession?.providerLocked && currentSession.providerId !== provider.id) {
      return;
    }

    const resolvedModelId = resolveSelectedModelId(provider, requestedModelId);
    if (!resolvedModelId) {
      return;
    }

    const isSameProvider = provider.id === currentProvider?.id;
    const isSameModel = resolvedModelId === currentModelId;
    if (isSameProvider && isSameModel) {
      setOpen(false);
      return;
    }

    const nextModelOverride = resolveSelectedModelOverride(provider, resolvedModelId);
    const selectionKey = `${provider.id}:${resolvedModelId}`;
    setPendingSelectionKey(selectionKey);

    try {
      if (!currentSession?.providerLocked && provider.id !== activeProvider?.id) {
        await window.zora.setDefaultProvider(provider.id);
        await loadProviders();
      }

      if (currentSession?.id) {
        await window.zora.switchSessionModel(currentSession.id, nextModelOverride);
        updateSessionMetaInState({
          sessionId: currentSession.id,
          updates: {
            selectedModelId: nextModelOverride || undefined,
          },
        });
      } else {
        setDraftSelectedModelId(nextModelOverride || undefined);
      }

      setOpen(false);
    } catch (error) {
      console.error("[model-selector] Failed to switch provider/model.", error);
    } finally {
      setPendingSelectionKey(null);
    }
  };

  const toggleProviderExpansion = (providerId: string) => {
    setExpandedProviders((current) => ({
      ...current,
      [providerId]:
        current[providerId] === undefined
          ? providerId !== currentProvider?.id
          : !current[providerId],
    }));
  };

  const renderModelButton = (
    provider: ProviderConfig,
    modelId: string,
    label: string,
    compact = false
  ) => {
    const isSelected =
      provider.id === currentProvider?.id && modelId === currentModelId;
    const selectionKey = `${provider.id}:${modelId}`;

    return (
      <button
        key={selectionKey}
        type="button"
        disabled={pendingSelectionKey !== null}
        onClick={() => {
          void handleSelectModel(provider, modelId);
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left transition-colors",
          "disabled:cursor-wait disabled:opacity-70",
          isSelected
            ? "bg-stone-100/90 text-stone-900"
            : "text-stone-700 hover:bg-stone-50"
        )}
      >
        <span
          className={cn(
            "flex h-4.5 w-4.5 shrink-0 items-center justify-center text-[13px] font-semibold",
            isSelected ? "text-stone-900" : "text-stone-300"
          )}
        >
          {isSelected ? "✓" : "•"}
        </span>

        <div className="min-w-0 flex-1">
          {!compact ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-stone-800">
                {provider.name}
              </span>
              <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10.5px] font-medium text-stone-600">
                {PROVIDER_PRESETS[provider.providerType].label}
              </span>
            </div>
          ) : null}

          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] text-stone-700">{modelId}</span>
            <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
              {label}
            </span>
          </div>
        </div>

        {pendingSelectionKey === selectionKey ? (
          <span className="shrink-0 text-[11px] text-stone-400">切换中…</span>
        ) : null}
      </button>
    );
  };

  const renderProviderSection = (provider: ProviderConfig) => {
    const models = getProviderModels(provider);
    const selectedModelId = resolveSelectedModelId(
      provider,
      provider.id === currentProvider?.id ? currentModelId : undefined
    );
    const selectedModel = models.find((model) => model.modelId === selectedModelId);
    const isActiveProvider = provider.id === currentProvider?.id;

    if (models.length <= 1) {
      const onlyModel = models[0];
      if (!onlyModel) {
        return null;
      }

      return (
        <div key={provider.id} className="py-0.5">
          {renderModelButton(provider, onlyModel.modelId, onlyModel.label)}
        </div>
      );
    }

    const isExpanded = expandedProviders[provider.id] ?? isActiveProvider;

    return (
      <div key={provider.id} className="py-0.5">
        <button
          type="button"
          disabled={pendingSelectionKey !== null}
          onClick={() => toggleProviderExpansion(provider.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left transition-colors",
            "disabled:cursor-wait disabled:opacity-70",
            isActiveProvider ? "bg-stone-50 text-stone-900" : "text-stone-700 hover:bg-stone-50"
          )}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform",
              isExpanded ? "rotate-90" : ""
            )}
            aria-hidden="true"
          >
            <path d="m7 5 6 5-6 5" />
          </svg>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-stone-800">
                {provider.name}
              </span>
              <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10.5px] font-medium text-stone-600">
                {PROVIDER_PRESETS[provider.providerType].label}
              </span>
            </div>
            {selectedModel ? (
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-stone-500">
                <span className="truncate">{selectedModel.modelId}</span>
                <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                  {selectedModel.label}
                </span>
              </div>
            ) : null}
          </div>

          {isActiveProvider ? (
            <span className="shrink-0 text-[13px] font-semibold text-stone-700">✓</span>
          ) : null}
        </button>

        {isExpanded ? (
          <div className="ml-5 mt-1 space-y-1 border-l border-stone-200 pl-2">
            {models.map((model) =>
              renderModelButton(provider, model.modelId, model.label, true)
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={12}
          className={cn(
            "z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-[14px] border border-stone-200 bg-white p-1 shadow-lg",
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          {isMissingLockedProvider ? (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-3">
              <div className="text-[13px] font-medium text-rose-600">
                此会话绑定的 Provider 已被删除
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-rose-500">
                请创建新会话，或在设置中重新添加这个 Provider。
              </p>
            </div>
          ) : isLocked && lockedProvider ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 rounded-[10px] bg-stone-50 px-3 py-2 text-stone-700">
                <LockIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                <span className="truncate text-[13px] font-medium">
                  {lockedProvider.name}
                </span>
                <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-stone-600">
                  {PROVIDER_PRESETS[lockedProvider.providerType].label}
                </span>
              </div>

              <div className="space-y-1">
                {getProviderModels(lockedProvider).map((model) =>
                  renderModelButton(
                    lockedProvider,
                    model.modelId,
                    model.label,
                    true
                  )
                )}
              </div>
            </div>
          ) : enabledProviders.length > 0 ? (
            <div className="space-y-1">
              {enabledProviders.map((provider) => renderProviderSection(provider))}
            </div>
          ) : (
            <div className="rounded-[12px] border border-stone-200 bg-stone-50 px-3 py-3 text-[12px] leading-relaxed text-stone-500">
              还没有可用的 Provider，请先到设置里添加并启用一个模型配置。
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
