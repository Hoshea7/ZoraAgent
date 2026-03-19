import { useState, type ReactElement } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { activeProviderAtom, loadProvidersAtom, providersAtom } from "../../store/provider";
import { PROVIDER_PRESETS } from "../../../shared/types/provider";
import { cn } from "../../utils/cn";

export interface ModelSelectorProps {
  trigger: ReactElement;
}

export function ModelSelector({ trigger }: ModelSelectorProps) {
  const activeProvider = useAtomValue(activeProviderAtom);
  const providers = useAtomValue(providersAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const [isSwitchingId, setIsSwitchingId] = useState<string | null>(null);
  const enabledProviders = providers.filter((provider) => provider.enabled);

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
            "z-50 min-w-[256px] overflow-hidden rounded-[14px] border border-stone-200 bg-white p-1 shadow-lg",
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          {enabledProviders.length > 0 ? (
            <>
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
                      "group flex cursor-pointer select-none items-start gap-2.5 rounded-[10px] px-3 py-2 outline-none transition-colors",
                      "text-stone-700 data-[disabled]:cursor-wait data-[disabled]:opacity-70",
                      isActive
                        ? "bg-stone-100/90"
                        : "hover:bg-stone-50 focus:bg-stone-50"
                    )}
                  >
                    <div className="flex h-4.5 w-4.5 shrink-0 items-center justify-center pt-0.5">
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
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 font-medium text-[10.5px] text-stone-600">
                          {presetLabel}
                        </span>
                        <span className="truncate text-[13px] font-medium text-stone-800">
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

            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
