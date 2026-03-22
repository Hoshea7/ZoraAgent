import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { createPortal } from "react-dom";
import type { MemorySettings } from "../../../shared/types/memory";
import { mcpConfigAtom } from "../../store/mcp";
import { loadSkillsAtom, skillsAtom } from "../../store/skill";
import { isSettingsOpenAtom, settingsTabAtom } from "../../store/ui";
import {
  emitMemorySettingsUpdated,
  MEMORY_SETTINGS_UPDATED_EVENT,
} from "../../utils/memory-settings-event";

function MemoryProcessButton() {
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const clearTimerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [bubblePosition, setBubblePosition] = useState<{ left: number; top: number } | null>(
    null
  );
  const gradientId = useId();

  useEffect(() => {
    let isActive = true;

    const loadPendingCount = async () => {
      try {
        const count = await window.zora.memory.getPendingCount();
        if (!isActive) {
          return;
        }
        setPendingCount(count);
      } catch (error) {
        console.error("[MemoryProcessButton] getPendingCount failed:", error);
      }
    };

    void loadPendingCount();
    const unsubscribe = window.zora.memory.onPendingChanged((count) => {
      if (!isActive) {
        return;
      }
      setPendingCount(count);
    });

    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      isActive = false;
      unsubscribe();
    };
  }, []);

  const handleClick = async () => {
    if (loading || pendingCount === 0) {
      return;
    }

    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const { total, processed } = await window.zora.memory.processNow();
      if (total === 0) {
        setFeedback("没有待处理的会话");
      } else if (processed === 0) {
        setFeedback("会话消息不足，已跳过");
      } else {
        setFeedback("记忆处理完成");
      }
    } catch (error) {
      console.error("[MemoryProcessButton] processNow failed:", error);
      setFeedback("处理失败");
    } finally {
      setLoading(false);
      clearTimerRef.current = window.setTimeout(() => {
        setFeedback(null);
        clearTimerRef.current = null;
      }, 3000);
    }
  };

  const hasPending = pendingCount > 0;
  const canClick = !loading && hasPending;
  const cursorClass = loading
    ? "cursor-default"
    : hasPending
      ? "cursor-pointer"
      : "cursor-not-allowed";
  const colorClass = loading
    ? "text-amber-300"
    : hasPending
      ? "text-amber-400"
      : "text-zinc-500";
  const titleText = loading
    ? "记忆处理中，请稍等..."
    : hasPending
      ? "有新的对话记忆待处理，点击立即处理"
      : "暂无需要处理的记忆会话";
  const shouldShowTooltip = isHovered && feedback === null;
  const overlayText = feedback ?? (shouldShowTooltip ? titleText : null);

  useLayoutEffect(() => {
    if (!overlayText) {
      setBubblePosition(null);
      return;
    }

    const updateBubblePosition = () => {
      const button = buttonRef.current;

      if (!button) {
        return;
      }

      const buttonRect = button.getBoundingClientRect();
      const gap = 10;

      setBubblePosition({
        left: buttonRect.left + buttonRect.width / 2,
        top: buttonRect.top - gap,
      });
    };

    updateBubblePosition();
    window.addEventListener("resize", updateBubblePosition);
    window.addEventListener("scroll", updateBubblePosition, true);

    return () => {
      window.removeEventListener("resize", updateBubblePosition);
      window.removeEventListener("scroll", updateBubblePosition, true);
    };
  }, [overlayText]);

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => void handleClick()}
        aria-disabled={!canClick}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${colorClass} ${cursorClass} ${
          canClick ? "hover:text-amber-300" : ""
        }`}
        aria-label={titleText}
      >
        <svg
          className={`relative z-10 h-4 w-4 transition duration-200 ${
            loading ? "animate-breathe" : ""
          } ${
            isHovered && !loading ? "scale-110 -translate-y-0.5" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="0"
              y1="12"
              x2="24"
              y2="12"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="32%" stopColor="#fbbf24" />
              <stop offset="46%" stopColor="#fff7cc" />
              <stop offset="50%" stopColor="#fffef7" />
              <stop offset="54%" stopColor="#fff7cc" />
              <stop offset="68%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f59e0b" />
              {loading ? (
                <animateTransform
                  attributeName="gradientTransform"
                  type="translate"
                  values="-18 0; 18 0; -18 0"
                  dur="1.9s"
                  repeatCount="indefinite"
                />
              ) : null}
            </linearGradient>
          </defs>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            stroke={loading ? `url(#${gradientId})` : "currentColor"}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
      </button>

      {overlayText
        ? createPortal(
            <div
              className={`pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm ${
                feedback
                  ? "bg-zinc-800 text-zinc-300"
                  : "border border-stone-200/80 bg-white/95 text-stone-700 shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
              }`}
              style={
                bubblePosition
                  ? {
                      left: bubblePosition.left,
                      top: bubblePosition.top,
                      transform: "translate(-50%, -100%)",
                    }
                  : {
                      visibility: "hidden",
                    }
              }
            >
              {overlayText}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/**
 * 侧边栏底部组件
 * 显示 MCP 和 Skills 状态，以及设置按钮
 */
export function SidebarFooter() {
  const mcpConfig = useAtomValue(mcpConfigAtom);
  const skills = useAtomValue(skillsAtom);
  const loadSkills = useSetAtom(loadSkillsAtom);
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const [memoryMode, setMemoryMode] = useState<MemorySettings["mode"] | null>(null);
  const enabledMcpCount = Object.values(mcpConfig.servers).filter(
    (server) => server.enabled
  ).length;
  const [memoryMode, setMemoryMode] = useState<MemorySettings["mode"] | null>(null);
  const enabledMcpCount = Object.values(mcpConfig.servers).filter(
    (server) => server.enabled
  ).length;

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    let isActive = true;

    const loadMemorySettings = async () => {
      try {
        const settings = await window.zora.memory.getSettings();
        if (!isActive) {
          return;
        }
        setMemoryMode(settings.mode);
        emitMemorySettingsUpdated(settings);
      } catch (error) {
        console.error("[SidebarFooter] Failed to load memory settings:", error);
      }
    };

    const handleMemorySettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<MemorySettings>).detail;
      if (!detail || !isActive) {
        return;
      }
      setMemoryMode(detail.mode);
    };

    void loadMemorySettings();
    window.addEventListener(MEMORY_SETTINGS_UPDATED_EVENT, handleMemorySettingsUpdated);

    return () => {
      isActive = false;
      window.removeEventListener(MEMORY_SETTINGS_UPDATED_EVENT, handleMemorySettingsUpdated);
    };
  }, []);

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center gap-3 px-3 text-[12px] text-stone-500">
        <button
          onClick={() => {
            setSettingsTab("mcp");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1.5 -ml-1.5 py-0.5 hover:bg-stone-200/50"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span>{enabledMcpCount} MCP</span>
        </button>
        <span className="h-1 w-1 rounded-full bg-stone-300"></span>
        <button
          onClick={() => {
            setSettingsTab("skills");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1.5 -mr-1.5 py-0.5 hover:bg-stone-200/50"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{skills.length} 个技能</span>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSettingsOpen(!isSettingsOpen)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] text-stone-500 transition-colors hover:bg-white/50 hover:text-stone-900"
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span>设置</span>
        </button>
        {memoryMode === "manual" ? <MemoryProcessButton /> : null}
      </div>
    </div>
  );
}
