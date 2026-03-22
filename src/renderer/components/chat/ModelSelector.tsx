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
import type { ProviderConfig } from "../../../shared/types/provider";
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
    modelId: string
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
          "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors",
          "disabled:cursor-wait disabled:opacity-70",
          isSelected
            ? "bg-stone-100/80 text-stone-900"
            : "text-stone-600 hover:bg-stone-50"
        )}
      >
        <span
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center text-[12px] font-medium",
            isSelected ? "text-stone-700" : "text-stone-300"
          )}
        >
          {isSelected ? "✓" : "·"}
        </span>

        <span className={cn("truncate text-[13px]", isSelected ? "font-medium" : "")}>
          {modelId}
        </span>

        {pendingSelectionKey === selectionKey ? (
          <span className="shrink-0 text-[11px] text-stone-400">…</span>
        ) : null}
      </button>
    );
  };

  const renderProviderSection = (provider: ProviderConfig) => {
    const models = getProviderModels(provider);
    const isActiveProvider = provider.id === currentProvider?.id;

    if (models.length === 0) {
      return null;
    }

    const isExpanded = expandedProviders[provider.id] ?? isActiveProvider;

    return (
      <div key={provider.id}>
        <button
          type="button"
          disabled={pendingSelectionKey !== null}
          onClick={() => toggleProviderExpansion(provider.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors",
            "disabled:cursor-wait disabled:opacity-70",
            isActiveProvider ? "text-stone-800" : "text-stone-500 hover:text-stone-700"
          )}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              isExpanded ? "rotate-90 text-stone-600" : "text-stone-400"
            )}
            aria-hidden="true"
          >
            <path d="m7 5 6 5-6 5" />
          </svg>

          <span className={cn("truncate text-[13px]", isActiveProvider ? "font-medium" : "")}>
                        {provider.name}
          </span>
        </button>

        {isExpanded ? (
          <div className="ml-5 mt-0.5 space-y-0.5 pl-1">
            {models.map((model) =>
              renderModelButton(provider, model.modelId)
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
            "z-50 w-[min(220px,calc(100vw-32px))] overflow-hidden rounded-[12px] border border-stone-200 bg-white p-1 shadow-lg",
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          {isMissingLockedProvider ? (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-3">
              <div className="text-[13px] font-medium text-rose-600">
                此会话绑定的 Provider 已被删除
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-rose-500">
                请创建新会话，或在设置中重新添加这个 Provider。
              </p>
            </div>
          ) : isLocked && lockedProvider ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-1.5 text-stone-700">
                <LockIcon className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                <span className="truncate text-[13px] font-medium">
                  {lockedProvider.name}
                </span>
              </div>

              {getProviderModels(lockedProvider).map((model) =>
                renderModelButton(lockedProvider, model.modelId)
              )}
            </div>
          ) : enabledProviders.length > 0 ? (
            <div className="space-y-0.5">
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
