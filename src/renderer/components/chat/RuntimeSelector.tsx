import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { AgentRuntimeType } from "../../../shared/types/provider";
import { resolveProviderProtocol } from "../../../shared/provider-protocol";
import { agentRuntimeSupportsProtocol } from "../../../shared/runtime-capabilities";
import { providersAtom } from "../../store/provider";
import { defaultModelSettingsAtom } from "../../store/default-model";
import {
  currentSessionAtom,
  currentWorkspaceIdAtom,
  draftAgentRuntimeTypeAtom,
  draftSelectedModelIdAtom,
  draftSelectedProviderIdAtom,
  setDraftAgentRuntimeTypeAtom,
  updateSessionMetaInStateAtom,
} from "../../store/workspace";
import { resolveCurrentProviderAndModel } from "../../utils/provider-selection";
import { cn } from "../../utils/cn";

const RUNTIME_LABELS: Record<AgentRuntimeType, string> = {
  claude: "Claude",
  pi: "Pi",
};

const RUNTIMES: AgentRuntimeType[] = ["pi", "claude"];

export function RuntimeSelector() {
  const session = useAtomValue(currentSessionAtom);
  const providers = useAtomValue(providersAtom);
  const defaultModelSettings = useAtomValue(defaultModelSettingsAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const draftSelectedProviderId = useAtomValue(draftSelectedProviderIdAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const draftRuntime = useAtomValue(draftAgentRuntimeTypeAtom);
  const setDraftRuntime = useSetAtom(setDraftAgentRuntimeTypeAtom);
  const updateSessionMeta = useSetAtom(updateSessionMetaInStateAtom);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const runtime = session?.agentRuntimeType ?? draftRuntime;
  const { provider } = resolveCurrentProviderAndModel(
    providers,
    session,
    defaultModelSettings,
    draftSelectedProviderId,
    draftSelectedModelId
  );
  const protocol = provider ? resolveProviderProtocol(provider) : null;

  useEffect(() => {
    if (!protocol || agentRuntimeSupportsProtocol(runtime, protocol)) return;
    if (session) {
      updateSessionMeta({
        sessionId: session.id,
        updates: { agentRuntimeType: "pi" },
        workspaceId: currentWorkspaceId,
      });
      void window.zora.setSessionRuntime(session.id, "pi", currentWorkspaceId);
      return;
    }
    setDraftRuntime("pi");
  }, [
    currentWorkspaceId,
    protocol,
    runtime,
    session,
    setDraftRuntime,
    updateSessionMeta,
  ]);

  if (!provider) return null;

  const selectRuntime = async (next: AgentRuntimeType) => {
    if (next === runtime) {
      setOpen(false);
      return;
    }
    if (session) {
      setIsSaving(true);
      try {
        await window.zora.setSessionRuntime(session.id, next, currentWorkspaceId);
        updateSessionMeta({
          sessionId: session.id,
          updates: { agentRuntimeType: next },
          workspaceId: currentWorkspaceId,
        });
      } catch (error) {
        console.error("[runtime-selector] Failed to save runtime.", error);
      } finally {
        setIsSaving(false);
      }
    } else {
      setDraftRuntime(next);
    }
    setOpen(false);
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={isSaving}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-50"
          aria-label="切换运行时"
          title="切换运行时（运行中修改将在下一轮生效）"
        >
          <span>{RUNTIME_LABELS[runtime]}</span>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="m5 7 5 6 5-6" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          className={cn(
            "z-50 w-[min(160px,calc(100vw-32px))] overflow-hidden rounded-[12px] border border-stone-200 bg-white p-1 shadow-[0_14px_38px_rgba(28,25,23,0.14)]",
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          {RUNTIMES.map((item) => {
            const supported = protocol
              ? agentRuntimeSupportsProtocol(item, protocol)
              : false;
            return (
              <DropdownMenu.Item
                key={item}
                disabled={isSaving || !supported}
                onSelect={(event) => {
                  event.preventDefault();
                  void selectRuntime(item);
                }}
                className="flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-stone-600 outline-none focus:bg-stone-50 data-[disabled]:text-stone-300"
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {item === runtime ? "✓" : ""}
                </span>
                <span>{RUNTIME_LABELS[item]}</span>
                {!supported ? <span className="ml-auto text-[11px]">不支持</span> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
