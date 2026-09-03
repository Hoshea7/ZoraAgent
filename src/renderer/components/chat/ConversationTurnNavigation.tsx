import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ConversationMessage } from "../../types";
import {
  CONVERSATION_TURN_NAVIGATION_MIN_TURNS,
  findActiveConversationTurnId,
  getConversationTurnMarkerScale,
  getConversationTurnPreview,
} from "../../utils/conversation-turn-navigation";
import { cn } from "../../utils/cn";

const TOOLTIP_ID = "conversation-turn-preview";
const TOOLTIP_HALF_HEIGHT_PX = 44;
const ACTIVE_LINE_MAX_OFFSET_PX = 160;
const ACTIVE_LINE_VIEWPORT_RATIO = 0.22;
const LATEST_CONTENT_THRESHOLD_PX = 4;

function formatTurnTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface PreviewState {
  turnId: string;
  anchorTop: number;
}

export interface ConversationTurnNavigationProps {
  turns: ConversationMessage[];
  scrollContainerRef: RefObject<HTMLElement>;
  contentRef: RefObject<HTMLElement>;
  onNavigate: (messageId: string) => void;
}

export function ConversationTurnNavigation({
  turns,
  scrollContainerRef,
  contentRef,
  onNavigate,
}: ConversationTurnNavigationProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const markerListRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const frameRef = useRef<number | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(
    turns.at(-1)?.id ?? null
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const selectedTurnIndex = preview
    ? turns.findIndex((turn) => turn.id === preview.turnId)
    : -1;

  const updateActiveTurn = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    const content = contentRef.current;
    if (!scrollContainer || !content || turns.length === 0) {
      return;
    }

    const distanceFromBottom =
      scrollContainer.scrollHeight -
      scrollContainer.scrollTop -
      scrollContainer.clientHeight;
    if (distanceFromBottom <= LATEST_CONTENT_THRESHOLD_PX) {
      setActiveTurnId(turns.at(-1)?.id ?? null);
      return;
    }

    const positions = turns.flatMap((turn) => {
      const row = content.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(turn.id)}"]`
      );
      return row ? [{ id: turn.id, offsetTop: row.offsetTop }] : [];
    });
    const activationLine =
      scrollContainer.scrollTop +
      Math.min(
        ACTIVE_LINE_MAX_OFFSET_PX,
        scrollContainer.clientHeight * ACTIVE_LINE_VIEWPORT_RATIO
      );
    setActiveTurnId(findActiveConversationTurnId(positions, activationLine));
  }, [contentRef, scrollContainerRef, turns]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const scheduleUpdate = () => {
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateActiveTurn();
      });
    };

    updateActiveTurn();
    scrollContainer.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scrollContainerRef, updateActiveTurn]);

  useLayoutEffect(() => {
    const markerList = markerListRef.current;
    const activeMarker = activeTurnId
      ? markerRefs.current.get(activeTurnId)
      : undefined;
    if (!markerList || !activeMarker) {
      return;
    }

    const markerTop = activeMarker.offsetTop;
    const markerBottom = markerTop + activeMarker.offsetHeight;
    if (markerTop < markerList.scrollTop) {
      markerList.scrollTop = markerTop;
    } else if (markerBottom > markerList.scrollTop + markerList.clientHeight) {
      markerList.scrollTop = markerBottom - markerList.clientHeight;
    }
  }, [activeTurnId]);

  useEffect(() => {
    if (preview && !turns.some((turn) => turn.id === preview.turnId)) {
      setPreview(null);
    }
  }, [preview, turns]);

  if (turns.length < CONVERSATION_TURN_NAVIGATION_MIN_TURNS) {
    return null;
  }

  const previewTurn = preview
    ? turns.find((turn) => turn.id === preview.turnId)
    : undefined;
  const previewIndex = previewTurn ? selectedTurnIndex : -1;

  const showPreview = (turnId: string, marker: HTMLButtonElement) => {
    const navigation = navigationRef.current;
    if (!navigation) {
      return;
    }
    const navigationRect = navigation.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const markerCenter = markerRect.top - navigationRect.top + markerRect.height / 2;
    const navigationHeight = navigationRect.height;
    setPreview({
      turnId,
      anchorTop: Math.max(
        TOOLTIP_HALF_HEIGHT_PX,
        Math.min(
          Math.max(TOOLTIP_HALF_HEIGHT_PX, navigationHeight - TOOLTIP_HALF_HEIGHT_PX),
          markerCenter
        )
      ),
    });
  };

  return (
    <nav
      ref={navigationRef}
      aria-label="会话轮次"
      data-testid="conversation-turn-navigation"
      className="absolute left-0 top-1/2 z-40 flex max-h-[min(66vh,420px)] -translate-y-1/2 items-start"
      onMouseLeave={() => setPreview(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setPreview(null);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setPreview(null);
        }
      }}
    >
      <div
        ref={markerListRef}
        className="max-h-[min(66vh,420px)] overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {turns.map((turn, index) => {
          const isActive = turn.id === activeTurnId;
          const isPreviewed = turn.id === preview?.turnId;
          const turnPreview = getConversationTurnPreview(turn);
          return (
            <button
              key={turn.id}
              ref={(node) => {
                if (node) {
                  markerRefs.current.set(turn.id, node);
                } else {
                  markerRefs.current.delete(turn.id);
                }
              }}
              type="button"
              aria-label={`第 ${index + 1} 轮：${turnPreview}`}
              aria-current={isActive ? "step" : undefined}
              aria-describedby={isPreviewed ? TOOLTIP_ID : undefined}
              onMouseEnter={(event) => showPreview(turn.id, event.currentTarget)}
              onFocus={(event) => showPreview(turn.id, event.currentTarget)}
              onClick={() => {
                setPreview(null);
                onNavigate(turn.id);
              }}
              className="flex h-3 w-9 cursor-pointer items-center px-1 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                data-testid="conversation-turn-marker"
                style={{
                  transform: `scaleX(${getConversationTurnMarkerScale(
                    index,
                    selectedTurnIndex >= 0 ? selectedTurnIndex : null
                  )})`,
                }}
                className={cn(
                  "block h-0.5 w-2 origin-left rounded-full transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-colors",
                  isPreviewed
                    ? "bg-stone-800"
                    : isActive
                      ? "bg-stone-600"
                      : "bg-stone-300"
                )}
              />
            </button>
          );
        })}
      </div>

      {previewTurn && previewIndex >= 0 ? (
        <div
          id={TOOLTIP_ID}
          role="tooltip"
          style={{ top: preview?.anchorTop ?? TOOLTIP_HALF_HEIGHT_PX }}
          className="pointer-events-none absolute left-10 w-64 min-[1100px]:w-72 -translate-y-1/2 rounded-xl bg-white px-3.5 py-3 text-left shadow-[0_8px_28px_rgba(28,25,23,0.14)] ring-1 ring-stone-200/80"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium leading-4 text-stone-500">
            <span>第 {previewIndex + 1} 轮</span>
            <span aria-hidden="true" className="text-stone-300">·</span>
            <time dateTime={new Date(previewTurn.timestamp).toISOString()}>
              {formatTurnTime(previewTurn.timestamp)}
            </time>
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-stone-800">
            {getConversationTurnPreview(previewTurn)}
          </p>
        </div>
      ) : null}
    </nav>
  );
}
