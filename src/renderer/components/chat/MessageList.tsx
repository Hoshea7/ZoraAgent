import { useRef, useEffect, useState, useMemo, useLayoutEffect, type ReactNode } from "react";
import { useAtom } from "jotai";
import type { ChatMessage } from "../../types";
import { messagesAtom, isAgentIdleAtom, isRunningAtom } from "../../store/chat";
import { currentSessionIdAtom } from "../../store/workspace";
import { MessageItem, ThinkingTrace, ToolCard } from "./MessageItem";
import { MarkdownMessage } from "./MarkdownMessage";
import { EmptyState } from "./EmptyState";
import { cn } from "../../utils/cn";

type DisplayItem =
  | {
      kind: "message";
      key: string;
      message: ChatMessage;
      showAvatar?: boolean;
      showCopyButton?: boolean;
      processContent?: ReactNode;
    }
  | {
      kind: "tool_group";
      key: string;
      messages: ChatMessage[];
      showAvatar: boolean;
    };

function isToolMessage(message: ChatMessage) {
  return message.type === "tool_use" || Boolean(message.toolName);
}

function hasAssistantBody(message: ChatMessage) {
  return message.role === "assistant" && message.text.trim().length > 0;
}

function createThinkingClone(message: ChatMessage): ChatMessage {
  return {
    ...message,
    id: `${message.id}::thinking`,
    type: "thinking",
    text: "",
    thinking: message.thinking,
    error: undefined
  };
}

function appendFallbackAssistantItems(
  items: DisplayItem[],
  assistantMessages: ChatMessage[],
  showAvatarForFirst: boolean
) {
  let currentToolGroup: ChatMessage[] = [];
  let renderedAssistantItems = 0;

  const flushToolGroup = () => {
    if (currentToolGroup.length === 0) {
      return;
    }

    items.push({
      kind: "tool_group",
      key: currentToolGroup.map((message) => message.id).join(":"),
      messages: [...currentToolGroup],
      showAvatar: showAvatarForFirst && renderedAssistantItems === 0
    });
    renderedAssistantItems += 1;
    currentToolGroup = [];
  };

  assistantMessages.forEach((message) => {
    if (isToolMessage(message)) {
      currentToolGroup.push(message);
      return;
    }

    flushToolGroup();
    items.push({
      kind: "message",
      key: message.id,
      message,
      showAvatar: showAvatarForFirst && renderedAssistantItems === 0
    });
    renderedAssistantItems += 1;
  });

  flushToolGroup();
}

function appendAssistantTurnItems(items: DisplayItem[], assistantMessages: ChatMessage[]) {
  if (assistantMessages.length === 0) {
    return;
  }

  const lastBodyIndex = assistantMessages.findLastIndex((message) => hasAssistantBody(message));

  if (lastBodyIndex === -1) {
    appendFallbackAssistantItems(items, assistantMessages, true);
    return;
  }

  const visibleMessage = assistantMessages[lastBodyIndex];
  const hiddenMessages = assistantMessages.flatMap((message, index) => {
    if (index === lastBodyIndex) {
      return message.thinking.trim().length > 0 ? [createThinkingClone(message)] : [];
    }

    return [message];
  });

  items.push({
    kind: "message",
    key: visibleMessage.id,
    message: {
      ...visibleMessage,
      thinking: ""
    },
    showAvatar: true,
    showCopyButton: true,
    processContent:
      hiddenMessages.length > 0 ? <AssistantProcessInline messages={hiddenMessages} /> : undefined
  });
}

function BouncingDots() {
  return (
    <div className="flex h-6 items-center gap-1.5">
      {[0, 150, 300].map((delay) => (
        <div
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-300"
          style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
        />
      ))}
    </div>
  );
}

function ToolGroupRow({ messages, showAvatar }: { messages: ChatMessage[], showAvatar: boolean }) {
  const [allExpanded, setAllExpanded] = useState(true);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  const handleToolToggle = (messageId: string) => {
    if (allExpanded) {
      setAllExpanded(false);
      setExpandedToolId(null);
      return;
    }

    setExpandedToolId((current) => (current === messageId ? null : messageId));
  };

  return (
    <div className="flex flex-col w-full">
      {messages.map((message, index) => (
        <MessageItem 
          key={message.id} 
          message={message} 
          showAvatar={showAvatar && index === 0} 
          toolOpen={allExpanded || expandedToolId === message.id}
          onToolToggle={handleToolToggle}
        />
      ))}
    </div>
  );
}

function FoldedAssistantMessage({ message }: { message: ChatMessage }) {
  const [isToolOpen, setIsToolOpen] = useState(true);

  if (isToolMessage(message)) {
    return (
      <ToolCard
        message={message}
        isOpen={isToolOpen}
        onToggleGroup={() => setIsToolOpen((current) => !current)}
      />
    );
  }

  const hasThinking = message.thinking.trim().length > 0;
  const hasText = message.text.trim().length > 0;
  const isStreaming = message.status === "streaming";

  return (
    <div>
      {hasThinking ? (
        <ThinkingTrace content={message.thinking} isStreaming={isStreaming && !hasText} />
      ) : null}

      {hasText ? (
        <div
          className={cn(
            "text-[15px] leading-[1.6] text-stone-800 break-words",
            hasThinking ? "mt-3" : "mt-0"
          )}
        >
          <MarkdownMessage content={message.text} />
          {isStreaming ? (
            <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-stone-300 align-middle"></span>
          ) : null}
        </div>
      ) : null}

      {message.error ? (
        <div className="mt-3 rounded-xl bg-rose-50/80 px-4 py-3 text-[14px] leading-relaxed text-rose-800 ring-1 ring-rose-200/50">
          {message.error}
        </div>
      ) : null}
    </div>
  );
}

function AssistantProcessInline({ messages }: { messages: ChatMessage[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const isStreaming = messages.some(
    (message) => message.status === "streaming" || message.toolStatus === "running"
  );

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="group flex items-center gap-2 rounded-lg py-1 text-left text-[13.5px] text-stone-500 transition-colors hover:text-stone-800"
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-stone-400">
          思考内容
        </span>
        <span className="text-stone-300">·</span>
        <span className="text-stone-500">{messages.length} 项</span>
        {isStreaming ? (
          <span className="relative ml-1 flex h-1.5 w-1.5 items-center justify-center">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-stone-400 opacity-75"></span>
            <span className="relative inline-flex h-1 w-1 rounded-full bg-stone-500"></span>
          </span>
        ) : null}
        <svg
          className={`h-3.5 w-3.5 text-stone-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {isOpen ? (
        <div className="mt-2 space-y-3">
          {messages.map((message) => (
            <FoldedAssistantMessage key={message.id} message={message} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PendingAssistantRow({ showDots }: { showDots: boolean }) {
  return (
    <div className="mr-auto mt-8 flex w-full max-w-[95%] items-start gap-4">
      <div className="mt-1 flex w-8 shrink-0 justify-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm ring-1 ring-blue-600/50">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="mb-2 mt-0.5 flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-tight text-stone-800">Zora</span>
          <span className="mt-[2px] text-[11px] font-medium text-stone-400">
            {new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            })}
          </span>
        </div>

        {showDots ? <BouncingDots /> : null}
      </div>
    </div>
  );
}

/**
 * 消息列表组件
 * 显示所有消息并自动滚动到底部
 */
export function MessageList() {
  const [messages] = useAtom(messagesAtom);
  const [isAgentIdle] = useAtom(isAgentIdleAtom);
  const [isRunning] = useAtom(isRunningAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previousSessionIdRef = useRef<string | null>(currentSessionId);
  const shouldSnapToBottomRef = useRef(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsScrolledUp(distanceFromBottom > 50);
  };

  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    setIsScrolledUp(false);
    container.scrollTop = container.scrollHeight;
  };

  const lastUserIndex = useMemo(
    () => messages.reduce((acc, msg, i) => (msg.role === "user" ? i : acc), -1),
    [messages]
  );

  const hasAssistantInCurrentTurn = useMemo(
    () => lastUserIndex >= 0 && messages.slice(lastUserIndex + 1).some((m) => m.role === "assistant"),
    [messages, lastUserIndex]
  );

  const displayItems = useMemo(() => {
    const items: DisplayItem[] = [];
    let assistantTurn: ChatMessage[] = [];

    const flushAssistantTurn = () => {
      appendAssistantTurnItems(items, assistantTurn);
      assistantTurn = [];
    };

    messages.forEach((message) => {
      if (message.role === "user") {
        flushAssistantTurn();
        items.push({
          kind: "message",
          key: message.id,
          message
        });
        return;
      }

      assistantTurn.push(message);
    });

    flushAssistantTurn();

    return items;
  }, [messages]);

  useEffect(() => {
    if (previousSessionIdRef.current !== currentSessionId) {
      previousSessionIdRef.current = currentSessionId;
      shouldSnapToBottomRef.current = true;
      setIsScrolledUp(false);
    }
  }, [currentSessionId]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    if (shouldSnapToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      shouldSnapToBottomRef.current = false;
      return;
    }

    if (!isScrolledUp) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, isAgentIdle, isRunning, isScrolledUp, currentSessionId]);

  if (messages.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto px-5 py-5 sm:px-8 custom-scrollbar overscroll-none">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div 
        className="h-full w-full overflow-y-auto px-5 py-5 sm:px-8 custom-scrollbar overscroll-none"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <div className="mx-auto flex max-w-4xl flex-col pb-4">
          {displayItems.map((item) => {
            if (item.kind === "tool_group") {
              return (
                <ToolGroupRow
                  key={item.key}
                  messages={item.messages}
                  showAvatar={item.showAvatar}
                />
              );
            }

            return (
              <MessageItem
                key={item.key}
                message={item.message}
                showAvatar={item.showAvatar}
                showCopyButton={item.showCopyButton}
                processContent={item.processContent}
              />
            );
          })}

          {isRunning && !hasAssistantInCurrentTurn ? (
            <PendingAssistantRow showDots={isAgentIdle} />
          ) : null}

          {isRunning && hasAssistantInCurrentTurn && isAgentIdle ? (
            <div className="mr-auto mt-1 flex w-full max-w-[95%] items-start gap-4">
              <div className="w-8 shrink-0" />
              <BouncingDots />
            </div>
          ) : null}
          
          <div className="h-4" />
        </div>
      </div>

      {isScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white p-2 shadow-md border border-stone-200 text-stone-500 hover:text-stone-900 z-50 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          title="回到底部"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
}
