import { useAtom } from "jotai";
import { currentModeAtom } from "../../store/ui";
import { cn } from "../../utils/cn";
import type { Mode } from "../../types";

/**
 * 模式切换组件
 * 在 Chat 和 Agent 模式之间切换
 */
export function ModeToggle() {
  const [currentMode, setCurrentMode] = useAtom(currentModeAtom);

  const modes: { value: Mode; label: string }[] = [
    { value: "chat", label: "Chat" },
    { value: "agent", label: "Agent" }
  ];

  return (
    <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
      {modes.map((mode) => (
        <button
          key={mode.value}
          onClick={() => setCurrentMode(mode.value)}
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition",
            currentMode === mode.value
              ? "bg-white text-stone-900 shadow-sm"
              : "text-stone-600 hover:text-stone-900"
          )}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
