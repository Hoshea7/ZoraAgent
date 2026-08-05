import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { activeProviderAtom } from "../../store/provider";
import {
  currentSessionAtom,
  currentWorkspaceIdAtom,
  updateSessionMetaInStateAtom,
} from "../../store/workspace";
import {
  getCompatibleRuntimes,
  type RuntimeType,
  type ProviderType,
} from "../../../shared/types/provider";
import { cn } from "../../utils/cn";

const RUNTIME_LABELS: Record<RuntimeType, string> = {
  claude: "Claude",
  pi: "Pi",
};

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

export function RuntimeSelector() {
  const session = useAtomValue(currentSessionAtom);
  const activeProvider = useAtomValue(activeProviderAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const updateSessionMetaInState = useSetAtom(updateSessionMetaInStateAtom);
  const [open, setOpen] = useState(false);

  const runtimeType: RuntimeType = session?.runtimeType ?? "claude";
  const runtimeLocked = session?.runtimeLocked ?? false;

  const providerType: ProviderType = activeProvider?.providerType ?? "anthropic";
  const compatibleRuntimes = getCompatibleRuntimes(providerType);

  if (!activeProvider) return null;

  const handleSelect = (next: RuntimeType) => {
    if (runtimeLocked || next === runtimeType) return;

    if (session) {
      updateSessionMetaInState({
        sessionId: session.id,
        updates: { runtimeType: next },
        workspaceId: currentWorkspaceId,
      });
      void window.zora.setSessionRuntime(
        session.id,
        next,
        currentWorkspaceId
      );
    }
    setOpen(false);
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={runtimeLocked}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:ring-offset-1",
            runtimeLocked
              ? "cursor-not-allowed text-stone-300"
              : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
          )}
          aria-label="切换运行时"
          title={
            runtimeLocked ? "首条消息后不可切换运行时" : "切换运行时"
          }
        >
          {runtimeLocked ? (
            <LockIcon className="h-3.5 w-3.5 shrink-0 text-stone-300" />
          ) : null}
          <span className="truncate">{RUNTIME_LABELS[runtimeType]}</span>
          {!runtimeLocked ? (
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
          ) : null}
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
            const isCompatible = compatibleRuntimes.includes(rt);
            const isSelected = rt === runtimeType;
            return (
              <button
                key={rt}
                type="button"
                disabled={!isCompatible || isSelected}
                onClick={() => handleSelect(rt)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors",
                  isSelected
                    ? "bg-stone-100/80 text-stone-900"
                    : isCompatible
                      ? "text-stone-600 hover:bg-stone-50"
                      : "cursor-not-allowed text-stone-300"
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
                </span>
                {!isCompatible ? (
                  <span className="ml-auto shrink-0 text-[10px] text-stone-300">
                    不支持
                  </span>
                ) : null}
              </button>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
