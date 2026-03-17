import { useState, type ReactElement } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { activeProviderAtom, loadProvidersAtom, providersAtom } from "../../store/provider";
import { isSettingsOpenAtom, settingsTabAtom } from "../../store/ui";
import { PROVIDER_PRESETS } from "../../../shared/types/provider";
import { cn } from "../../utils/cn";

export interface ModelSelectorProps {
  trigger: ReactElement;
}

export function ModelSelector({ trigger }: ModelSelectorProps) {
  const activeProvider = useAtomValue(activeProviderAtom);
  const providers = useAtomValue(providersAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const [isSwitchingId, setIsSwitchingId] = useState<string | null>(null);
  const enabledProviders = providers.filter((provider) => provider.enabled);

  const openProviderSettings = () => {
    setSettingsTab("provider");
    setSettingsOpen(true);
  };

  const handleSelectProvider = async (providerId: string) => {
    if (providerId === activeProvider?.id) {
      return;
    }

    setIsSwitchingId(providerId);

    try {
      await window.zora.setDefaultProvider(providerId);
      await loadProviders();
    } catch (error) {
      console.error("[model-selector] Failed to switch provider.", error);
    } finally {
      setIsSwitchingId(null);
    }
  };

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={12}
          className={cn(
            "z-50 min-w-[280px] overflow-hidden rounded-[16px] border border-stone-200 bg-white p-1.5 shadow-lg",
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          {enabledProviders.length > 0 ? (
            <>
              <div className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-400">
                当前可用模型渠道
              </div>

              {enabledProviders.map((provider) => {
                const isActive = provider.id === activeProvider?.id;
                const presetLabel = PROVIDER_PRESETS[provider.providerType].label;

                return (
                  <DropdownMenu.Item
                    key={provider.id}
                    disabled={isSwitchingId !== null}
                    onSelect={() => {
                      void handleSelectProvider(provider.id);
                    }}
                    className={cn(
                      "group flex cursor-pointer select-none items-start gap-3 rounded-[12px] px-3 py-2.5 outline-none transition-colors",
                      "text-stone-700 data-[disabled]:cursor-wait data-[disabled]:opacity-70",
                      isActive
                        ? "bg-stone-100/90"
                        : "hover:bg-stone-50 focus:bg-stone-50"
                    )}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5">
                      <span
                        className={cn(
                          "text-[13px] font-semibold transition-colors",
                          isActive ? "text-stone-900" : "text-stone-300 group-hover:text-stone-500"
                        )}
                      >
                        {isActive ? "✓" : "•"}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-stone-900">
                        {provider.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-stone-500">
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">
                          {presetLabel}
                        </span>
                        <span className="truncate">
                          {provider.modelId?.trim() || "默认模型"}
                        </span>
                      </div>
                    </div>

                    {isSwitchingId === provider.id ? (
                      <div className="shrink-0 pt-0.5 text-[11px] text-stone-400">
                        切换中…
                      </div>
                    ) : null}
                  </DropdownMenu.Item>
                );
              })}

              <div className="my-1.5 h-px bg-stone-200" />
            </>
          ) : null}

          <DropdownMenu.Item
            onSelect={openProviderSettings}
            className={cn(
              "flex cursor-pointer select-none items-center justify-between rounded-[12px] px-3 py-2.5 outline-none transition-colors",
              "text-[13px] font-medium text-stone-700 hover:bg-stone-50 focus:bg-stone-50"
            )}
          >
            <span>前往设置配置</span>
            <span className="text-stone-400">↗</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
