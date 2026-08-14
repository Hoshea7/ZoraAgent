import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { StickToBottom, useStickToBottom } from "use-stick-to-bottom";
import { isRunningAtom, messagesAtom } from "../../store/chat";
import { currentSessionIdAtom } from "../../store/workspace";
import { AssistantMessage } from "./AssistantMessage";
import { BouncingDots } from "./BouncingDots";
import { EmptyState } from "./EmptyState";
import { UserMessage } from "./UserMessage";

const sessionDistanceFromBottom = new Map<string, number>();

function PendingAssistantRow() {
  return (
    <div className="mr-auto mt-8 w-full">
      <div className="mx-auto max-w-[820px] overflow-hidden">
        <div className="mb-2 mt-0.5 flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-tight text-stone-800">Zora</span>
          <span className="mt-[2px] text-[11px] font-medium text-stone-400">
            {new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
        </div>
        <BouncingDots />
      </div>
    </div>
  );
}

export function MessageList() {
  const messages = useAtomValue(messagesAtom);
  const isRunning = useAtomValue(isRunningAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const viewport = useStickToBottom({ initial: "instant", resize: "instant" });
  const previousSessionRef = useRef(currentSessionId);
  const previousLastMessageIdRef = useRef(messages.at(-1)?.id);
  const [isDetached, setIsDetached] = useState(false);

  const lastMessage = messages.at(-1);
  const showPendingAssistant =
    isRunning && lastMessage?.role !== "assistant" && lastMessage?.queueState !== "pending";

  useLayoutEffect(() => {
    const node = viewport.scrollRef.current;
    if (!node || previousSessionRef.current === currentSessionId) {
      return;
    }

    const previousSessionId = previousSessionRef.current;
    if (previousSessionId) {
      sessionDistanceFromBottom.set(
        previousSessionId,
        Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight)
      );
    }
    previousSessionRef.current = currentSessionId;
    setIsDetached(false);

    const distance = currentSessionId ? sessionDistanceFromBottom.get(currentSessionId) : undefined;
    requestAnimationFrame(() => {
      const currentNode = viewport.scrollRef.current;
      if (!currentNode) {
        return;
      }
      if (distance === undefined || distance <= 48) {
        viewport.scrollToBottom("instant");
      } else {
        viewport.stopScroll();
        currentNode.scrollTop = Math.max(
          0,
          currentNode.scrollHeight - currentNode.clientHeight - distance
        );
      }
    });
  }, [currentSessionId, viewport]);

  useLayoutEffect(() => {
    const nextLastMessageId = messages.at(-1)?.id;
    if (
      nextLastMessageId === previousLastMessageIdRef.current ||
      lastMessage?.role !== "user" ||
      lastMessage.queueState === "pending"
    ) {
      previousLastMessageIdRef.current = nextLastMessageId;
      return;
    }

    previousLastMessageIdRef.current = nextLastMessageId;
    const scrollNode = viewport.scrollRef.current;
    const messageNode = viewport.contentRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(lastMessage.id)}"]`
    );
    if (!scrollNode || !messageNode) {
      return;
    }
    viewport.stopScroll();
    setIsDetached(false);
    scrollNode.scrollTop = Math.max(0, messageNode.offsetTop - 20);
    viewport.scrollToBottom({ animation: "instant", duration: 80, ignoreEscapes: false });
  }, [lastMessage, messages, viewport]);

  const scrollToBottom = useCallback(() => {
    setIsDetached(false);
    viewport.scrollToBottom({
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      ignoreEscapes: true,
    });
  }, [viewport]);

  if (messages.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-8 custom-scrollbar overscroll-y-none">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <StickToBottom
        instance={viewport}
        data-message-scroll-container="true"
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          const node = event.currentTarget;
          setIsDetached(node.scrollHeight - node.scrollTop - node.clientHeight > 48);
        }}
        className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar overscroll-y-none"
      >
        <StickToBottom.Content className="min-h-full">
          <div className="h-5" />
          {messages.map((message, index) => {
            const isLatestStreamingAssistant =
              index === messages.length - 1 &&
              message.role === "assistant" &&
              message.turn?.status === "streaming";
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                className={`mx-auto w-full max-w-[920px] px-5 sm:px-8 [content-visibility:auto] [contain-intrinsic-size:auto_160px] ${
                  isLatestStreamingAssistant ? "min-h-[calc(100vh-250px)]" : ""
                }`}
              >
                {message.role === "user" ? (
                  <UserMessage message={message} />
                ) : (
                  <AssistantMessage message={message} />
                )}
              </div>
            );
          })}
          {showPendingAssistant ? (
            <div className="mx-auto min-h-[calc(100vh-250px)] w-full max-w-[920px] px-5 sm:px-8">
              <PendingAssistantRow />
            </div>
          ) : null}
          <div className="h-5" />
        </StickToBottom.Content>
      </StickToBottom>

      {isDetached || !viewport.isAtBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          data-testid="scroll-to-bottom"
          className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center justify-center rounded-full border border-stone-200 bg-white p-2 text-stone-500 shadow-md transition-colors hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
          title="回到底部"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
