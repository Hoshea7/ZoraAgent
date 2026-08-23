import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type {
  ProviderConfig,
  ReasoningLevel,
} from "../../../shared/types/provider";
import { providersAtom } from "../../store/provider";
import { defaultModelSettingsAtom } from "../../store/default-model";
import {
  currentSessionAtom,
  currentWorkspaceIdAtom,
  draftReasoningLevelAtom,
  draftSelectedModelIdAtom,
  draftSelectedProviderIdAtom,
  setDraftSelectedModelIdAtom,
  setDraftSelectedProviderIdAtom,
  updateSessionMetaInStateAtom,
} from "../../store/workspace";
import {
  getProviderModels,
  getRunnableProviders,
  resolveCurrentProviderAndModel,
  resolveDraftProviderAndModel,
  resolveSelectedModelId,
  resolveSelectedModelOverride,
} from "../../utils/provider-selection";
import { cn } from "../../utils/cn";

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  off: "关闭",
  high: "高",
  max: "最大",
};

const REASONING_LEVELS = ["off", "high", "max"] as const;
const REASONING_SLIDER_GEOMETRY: Record<
  ReasoningLevel,
  { thumbPosition: string; fillWidth: string }
> = {
  off: { thumbPosition: "10px", fillWidth: "0%" },
  high: { thumbPosition: "50%", fillWidth: "50%" },
  max: { thumbPosition: "calc(100% - 10px)", fillWidth: "100%" },
};

function ReasoningSlider({
  value,
  disabled,
  onChange,
}: {
  value: ReasoningLevel;
  disabled: boolean;
  onChange: (value: ReasoningLevel) => void;
}) {
  const index = REASONING_LEVELS.indexOf(value);
  const { thumbPosition, fillWidth } = REASONING_SLIDER_GEOMETRY[value];

  return (
    <div className="relative h-8 w-full px-2">
      <div className="pointer-events-none absolute inset-x-2 top-1/2 h-5 -translate-y-1/2">
        <div className="absolute inset-0 overflow-hidden rounded-full bg-[#f3e8df]">
          <div
            data-testid="reasoning-slider-fill"
            className="absolute inset-y-0 left-0 bg-[var(--color-brand)] transition-[width] duration-150"
            style={{ width: fillWidth }}
          />
        </div>
        {REASONING_LEVELS.map((level, markerIndex) => (
          <span
            key={level}
            className={cn(
              "absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
              markerIndex < index ? "bg-white/75" : "bg-[#d9bca8]"
            )}
            style={{ left: REASONING_SLIDER_GEOMETRY[level].thumbPosition }}
          />
        ))}
        <span
          data-testid="reasoning-slider-thumb"
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#dfc5b2] bg-white shadow-[0_1px_4px_rgba(99,55,31,0.22)] transition-[left] duration-150"
          style={{ left: thumbPosition }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(event) => {
          const next = REASONING_LEVELS[Number(event.target.value)];
          if (next) onChange(next);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait"
        aria-label="推理强度"
        aria-valuetext={REASONING_LABELS[value]}
      />
    </div>
  );
}

function Chevron({ direction = "right" }: { direction?: "right" | "down" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-3.5 w-3.5 shrink-0", direction === "down" && "rotate-90")}
      aria-hidden="true"
    >
      <path d="m7 5 6 5-6 5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
    >
      <rect x="6" y="11" width="12" height="9" rx="2" />
      <path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" />
    </svg>
  );
}

const contentClass = cn(
  "z-50 overflow-hidden rounded-[14px] border border-stone-200 bg-white p-1.5 shadow-[0_14px_38px_rgba(28,25,23,0.14)]",
  "animate-in fade-in zoom-in-95 duration-150"
);

export function AgentSettingsSelector({
  onOpenProviderSettings,
}: {
  onOpenProviderSettings: () => void;
}) {
  const providers = useAtomValue(providersAtom);
  const defaultModelSettings = useAtomValue(defaultModelSettingsAtom);
  const session = useAtomValue(currentSessionAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const draftSelectedProviderId = useAtomValue(draftSelectedProviderIdAtom);
  const draftSelectedModelId = useAtomValue(draftSelectedModelIdAtom);
  const draftReasoningLevel = useAtomValue(draftReasoningLevelAtom);
  const setDraftSelectedProviderId = useSetAtom(setDraftSelectedProviderIdAtom);
  const setDraftSelectedModelId = useSetAtom(setDraftSelectedModelIdAtom);
  const setDraftReasoningLevel = useSetAtom(draftReasoningLevelAtom);
  const updateSessionMetaInState = useSetAtom(updateSessionMetaInStateAtom);
  const [open, setOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [isSavingReasoning, setIsSavingReasoning] = useState(false);

  const enabledProviders = getRunnableProviders(providers);
  const {
    provider: currentProvider,
    modelId: currentModelId,
    isLocked,
    isLockedTargetUnavailable,
  } = resolveCurrentProviderAndModel(
    providers,
    session,
    defaultModelSettings,
    draftSelectedProviderId,
    draftSelectedModelId
  );
  const reasoning: ReasoningLevel = session
    ? session.reasoningLevel ?? "high"
    : draftReasoningLevel;
  const modelLabel = isLockedTargetUnavailable
    ? "模型不可用"
    : currentModelId ?? "配置模型";

  useEffect(() => {
    setOpen(false);
    setPendingModel(null);
  }, [session?.id, isLockedTargetUnavailable]);

  const selectModel = async (
    provider: ProviderConfig,
    requestedModelId?: string
  ) => {
    const modelId = resolveSelectedModelId(provider, requestedModelId);
    if (!modelId) return;
    if (provider.id === currentProvider?.id && modelId === currentModelId) {
      setOpen(false);
      return;
    }

    const selectionKey = `${provider.id}:${modelId}`;
    setPendingModel(selectionKey);
    try {
      if (session?.providerLocked) {
        const modelOverride = resolveSelectedModelOverride(provider, modelId);
        await window.zora.switchSessionModel(
          session.id,
          provider.id,
          modelOverride,
          currentWorkspaceId,
          {
            provider: provider.name,
            providerType: provider.providerType,
            model: modelId,
            selectionSource: modelOverride ? "selected" : "provider_default",
          }
        );
        updateSessionMetaInState({
          sessionId: session.id,
          updates: {
            providerId: provider.id,
            providerLocked: true,
            selectedModelId: modelOverride || undefined,
          },
          workspaceId: currentWorkspaceId,
        });
      } else {
        const next = resolveDraftProviderAndModel(
          providers,
          defaultModelSettings,
          provider,
          modelId
        );
        setDraftSelectedProviderId(next.providerId);
        setDraftSelectedModelId(next.modelId);
      }
      setOpen(false);
    } catch (error) {
      console.error("[agent-settings-selector] Failed to switch model.", error);
    } finally {
      setPendingModel(null);
    }
  };

  const selectReasoning = async (next: ReasoningLevel) => {
    if (next === reasoning) return;
    if (session) {
      setIsSavingReasoning(true);
      try {
        await window.zora.setSessionReasoningLevel(
          session.id,
          next,
          currentWorkspaceId
        );
        updateSessionMetaInState({
          sessionId: session.id,
          updates: { reasoningLevel: next },
          workspaceId: currentWorkspaceId,
        });
      } catch (error) {
        console.error("[agent-settings-selector] Failed to save reasoning.", error);
      } finally {
        setIsSavingReasoning(false);
      }
    } else {
      setDraftReasoningLevel(next);
    }
  };

  const renderModel = (provider: ProviderConfig, modelId: string) => {
    const selected =
      provider.id === currentProvider?.id && modelId === currentModelId;
    const key = `${provider.id}:${modelId}`;
    return (
      <DropdownMenu.Item
        key={key}
        disabled={pendingModel !== null}
        onSelect={(event) => {
          event.preventDefault();
          void selectModel(provider, modelId);
        }}
        className={cn(
          "flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none",
          selected ? "bg-stone-100 text-stone-900" : "text-stone-600 focus:bg-stone-50"
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center text-stone-500">
          {selected ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate">{modelId}</span>
        {pendingModel === key ? <span className="text-stone-400">…</span> : null}
      </DropdownMenu.Item>
    );
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 max-w-[310px] items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
          aria-label="切换模型与推理强度"
          data-reasoning-level={reasoning}
        >
          {isLocked ? <LockIcon /> : null}
          <span className="truncate">{modelLabel}</span>
          {reasoning !== "off" ? (
            <span className="shrink-0">{REASONING_LABELS[reasoning]}</span>
          ) : null}
          <Chevron direction="down" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={8}
          className={cn(contentClass, "w-[min(228px,calc(100vw-32px))]")}
        >
          {isLockedTargetUnavailable ? (
            <div className="rounded-lg px-3 py-2 text-[12px] leading-5 text-amber-700">
              当前模型不可用，请选择其他模型。
            </div>
          ) : null}
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger
                aria-label="选择模型"
                className="flex cursor-default select-none items-center gap-3 rounded-lg px-3 py-2 text-[13px] outline-none focus:bg-stone-50 data-[state=open]:bg-stone-50"
              >
                <span className="font-medium text-stone-800">模型</span>
                <span className="ml-auto max-w-[120px] truncate text-stone-400">
                  {modelLabel}
                </span>
                <Chevron />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={6}
                  collisionPadding={8}
                  className={cn(
                    contentClass,
                    "max-h-[min(60vh,360px)] w-[min(240px,calc(100vw-32px))] overflow-y-auto custom-scrollbar"
                  )}
                >
                  {enabledProviders.map((provider) => (
                    <div key={provider.id} className="py-0.5">
                      <div className="px-3 py-1 text-[11px] font-medium text-stone-400">
                        {provider.name}
                      </div>
                      {getProviderModels(provider).map((model) =>
                        renderModel(provider, model.modelId)
                      )}
                    </div>
                  ))}
                  {enabledProviders.length === 0 ? (
                    <DropdownMenu.Item
                      onSelect={onOpenProviderSettings}
                      className="cursor-default rounded-lg px-3 py-2 text-[13px] text-stone-600 outline-none focus:bg-stone-50"
                    >
                      配置模型
                    </DropdownMenu.Item>
                  ) : null}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>

          <div className="rounded-lg px-3 pb-2 pt-1.5 text-[13px]">
            <div className="mb-0.5">
              <span className="font-medium text-stone-800">推理强度</span>
            </div>
            <ReasoningSlider
              value={reasoning}
              disabled={isSavingReasoning}
              onChange={(next) => {
                void selectReasoning(next);
              }}
            />
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
