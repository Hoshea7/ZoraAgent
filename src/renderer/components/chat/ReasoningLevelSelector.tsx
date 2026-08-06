import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReasoningLevel } from "../../../shared/types/provider";
import {
  currentSessionAtom,
  currentWorkspaceIdAtom,
  draftReasoningLevelAtom,
  updateSessionMetaInStateAtom,
} from "../../store/workspace";
import { cn } from "../../utils/cn";

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  off: "关闭",
  high: "高",
  max: "最大",
};

const REASONING_DESCRIPTIONS: Record<ReasoningLevel, string> = {
  off: "不启用推理",
  high: "深度推理",
  max: "最大思考",
};

const ORDER: ReasoningLevel[] = ["off", "high", "max"];

export function ReasoningLevelSelector() {
  const session = useAtomValue(currentSessionAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const draftReasoningLevel = useAtomValue(draftReasoningLevelAtom);
  const updateSessionMetaInState = useSetAtom(updateSessionMetaInStateAtom);
  const setDraftReasoningLevel = useSetAtom(draftReasoningLevelAtom);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const reasoningLevel: ReasoningLevel = session
    ? session.reasoningLevel ?? "high"
    : draftReasoningLevel;

  const handleSelect = (next: ReasoningLevel) => {
    if (next === reasoningLevel) return;

    if (session) {
      setIsSaving(true);
      void window.zora
        .setSessionReasoningLevel(session.id, next, currentWorkspaceId)
        .then(() => {
          updateSessionMetaInState({
            sessionId: session.id,
            updates: { reasoningLevel: next },
            workspaceId: currentWorkspaceId,
          });
        })
        .catch((error) => {
          console.error("[reasoning-level-selector] Failed to save.", error);
        })
        .finally(() => setIsSaving(false));
    } else {
      setDraftReasoningLevel(next);
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
          aria-label="切换推理强度"
          title="切换推理强度（运行中修改将在下一轮生效）"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 shrink-0"
          >
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547Z" />
          </svg>
          <span className="truncate">
            {reasoningLevel === "off" ? "思考" : `思考: ${REASONING_LABELS[reasoningLevel]}`}
          </span>
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
            "z-50 w-[min(180px,calc(100vw-32px))] overflow-hidden rounded-[12px] border border-stone-200 bg-white p-1 shadow-lg",
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          {ORDER.map((effort) => {
            const isSelected = effort === reasoningLevel;
            return (
              <button
                key={effort}
                type="button"
                disabled={isSaving || isSelected}
                onClick={() => handleSelect(effort)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors",
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
                <span
                  className={cn(
                    "truncate text-[13px]",
                    isSelected ? "font-medium" : ""
                  )}
                >
                  {REASONING_LABELS[effort]}
                </span>
                <span className="ml-auto text-[11px] text-stone-400">
                  {REASONING_DESCRIPTIONS[effort]}
                </span>
              </button>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
