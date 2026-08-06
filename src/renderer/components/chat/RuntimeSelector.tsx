import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { providersAtom } from "../../store/provider";
import { defaultModelSettingsAtom } from "../../store/default-model";
import {
  currentSessionAtom,
  currentWorkspaceIdAtom,
  draftSelectedModelIdAtom,
  draftSelectedProviderIdAtom,
  draftRuntimeTypeAtom,
  setDraftRuntimeTypeAtom,
  updateSessionMetaInStateAtom,
} from "../../store/workspace";
import { resolveProviderProtocol } from "../../../shared/provider-protocol";
import { runtimeSupportsProtocol } from "../../../shared/runtime-capabilities";
import { resolveCurrentProviderAndModel } from "../../utils/provider-selection";
import {
  type RuntimeType,
} from "../../../shared/types/provider";
import { cn } from "../../utils/cn";

const RUNTIME_LABELS: Record<RuntimeType, string> = {
  claude: "Claude",
  pi: "Pi",
};

export function RuntimeSelector() {
  const session = useAtomValue(currentSessionAtom);
  const providers = useAtomValue(providersAtom);
  const defaultModelSettings = useAtomValue(defaultModelSettingsAtom);
  const draftSelectedProviderId = useAtomValue(draftSelectedProviderIdAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const draftRuntimeType = useAtomValue(draftRuntimeTypeAtom);
  const updateSessionMetaInState = useSetAtom(updateSessionMetaInStateAtom);
  const setDraftRuntimeType = useSetAtom(setDraftRuntimeTypeAtom);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const runtimeType: RuntimeType = session
    ? session.runtimeType ?? "pi"
    : draftRuntimeType;
  const { provider: currentProvider } = resolveCurrentProviderAndModel(
    providers,
    session,
    defaultModelSettings,
    draftSelectedProviderId,
    draftSelectedModelId
  );
  const protocol = currentProvider
    ? resolveProviderProtocol(currentProvider)
    : null;

  useEffect(() => {
    if (
      !protocol ||
      runtimeSupportsProtocol(runtimeType, protocol)
    ) {
      return;
    }

    if (session) {
      updateSessionMetaInState({
        sessionId: session.id,
        updates: { runtimeType: "pi" },
        workspaceId: currentWorkspaceId,
      });
      void window.zora.setSessionRuntime(session.id, "pi", currentWorkspaceId);
    } else {
      setDraftRuntimeType("pi");
    }
  }, [
    currentWorkspaceId,
    protocol,
    runtimeType,
    session,
    setDraftRuntimeType,
    updateSessionMetaInState,
  ]);

  if (!currentProvider) return null;

  const handleSelect = async (next: RuntimeType) => {
    if (next === runtimeType) return;

    if (session) {
      setIsSaving(true);
      try {
        await window.zora.setSessionRuntime(
          session.id,
          next,
          currentWorkspaceId
        );
        updateSessionMetaInState({
          sessionId: session.id,
          updates: { runtimeType: next },
          workspaceId: currentWorkspaceId,
        });
      } catch (error) {
        console.error("[runtime-selector] Failed to save runtime.", error);
      } finally {
        setIsSaving(false);
      }
    } else {
      setDraftRuntimeType(next);
    }
    setOpen(false);
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={isSaving}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:ring-offset-1",
            "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
          )}
          aria-label="切换运行时"
          title="切换运行时（运行中修改将在下一轮生效）"
        >
          <span className="truncate">{RUNTIME_LABELS[runtimeType]}</span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 shrink-0"
          >
            <path d="m5 7 5 6 5-6" />
          </svg>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="center"
          sideOffset={8}
          className={cn(
            "z-50 w-[min(160px,calc(100vw-32px))] overflow-hidden rounded-[12px] border border-stone-200 bg-white p-1 shadow-lg",
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          {(["claude", "pi"] as RuntimeType[]).map((rt) => {
            const isSelected = rt === runtimeType;
            const isSupported = protocol
              ? runtimeSupportsProtocol(rt, protocol)
              : false;
            return (
              <button
                key={rt}
                type="button"
                disabled={isSaving || isSelected || !isSupported}
                onClick={() => void handleSelect(rt)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors",
                  isSelected
                    ? "bg-stone-100/80 text-stone-900"
                    : !isSupported
                      ? "cursor-not-allowed text-stone-300"
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
                <span
                  className={cn(
                    "truncate text-[13px]",
                    isSelected ? "font-medium" : ""
                  )}
                >
                  {RUNTIME_LABELS[rt]}
                  {!isSupported ? "（当前协议不支持）" : ""}
                </span>
              </button>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
