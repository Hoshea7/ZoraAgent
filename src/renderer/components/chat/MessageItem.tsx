import { memo, useState, useEffect, useRef, useMemo } from "react";
import { useAtom } from "jotai";
import type { ChatMessage } from "../../types";
import { cn } from "../../utils/cn";
import { globalThinkingExpandedAtom, globalToolExpandedAtom } from "../../store/ui";
import { MarkdownMessage } from "./MarkdownMessage";

export interface MessageItemProps {
  message: ChatMessage;
  showAvatar?: boolean;
  forceExpandTool?: number;
  onToolToggle?: (isOpen: boolean) => void;
}

// Zora Avatar Icon
function ZoraAvatar() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-500 text-white shadow-sm mt-0.5">
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    </div>
  );
}

// Proma-style minimal Process Block wrapper
function ProcessBlock({
  icon,
  title,
  isStreaming,
  isOpen,
  onToggle,
  children,
  variant = "tool",
  containerRef
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  isStreaming?: boolean;
  isOpen: boolean;
  onToggle: (e?: React.MouseEvent) => void;
  children: React.ReactNode;
  variant?: "tool" | "thinking";
  containerRef?: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="mb-0.5 mt-0.5 w-full max-w-full relative group/block" ref={containerRef}>
      <div 
        className="flex cursor-pointer items-center justify-between gap-6 py-1 text-[13.5px] text-stone-500 hover:text-stone-800 transition-colors w-fit group"
        onClick={onToggle}
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          <span className="flex items-center justify-center w-3 h-3 text-stone-400 group-hover:text-stone-500 transition-colors shrink-0">
            {icon}
          </span>
          <span className="truncate flex items-center gap-1.5 leading-none">{title}</span>
          {isStreaming && (
            <span className="flex h-1.5 w-1.5 items-center justify-center shrink-0 ml-1">
              <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-stone-400 opacity-75"></span>
              <span className="relative inline-flex h-1 w-1 rounded-full bg-stone-500"></span>
            </span>
          )}
        </div>
        <svg 
          className={cn("h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-all shrink-0 ml-1", isOpen ? "rotate-90 opacity-40" : "")} 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      
      {isOpen && variant === "tool" && (
        <div className="mt-1.5 px-4 py-3 bg-stone-50 rounded-lg border border-stone-100 max-h-[400px] overflow-y-auto custom-scrollbar shadow-inner w-[calc(100%-1rem)]">
          {children}
        </div>
      )}

      {isOpen && variant === "thinking" && (
        <div className="mt-1 pl-[18px] pr-4">
          {children}
        </div>
      )}
    </div>
  );
}

function ThinkingTrace({ content, isStreaming }: { content: string, isStreaming: boolean }) {
  const [globalExpanded, setGlobalExpanded] = useAtom(globalThinkingExpandedAtom);
  // Auto-expand if streaming, otherwise use global preference
  const [isOpen, setIsOpen] = useState(isStreaming ? true : globalExpanded);

  // Force open when starting to stream
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    setGlobalExpanded(next); // remember preference
  };

  return (
    <ProcessBlock
      icon={<span className="text-[10px] leading-none mb-0.5">●</span>}
      title={isStreaming ? "思考中..." : "思考过程"}
      isStreaming={isStreaming}
      isOpen={isOpen}
      onToggle={handleToggle}
      variant="thinking"
    >
      <div className="text-[13.5px] leading-relaxed text-stone-500">
        <pre className="m-0 whitespace-pre-wrap font-sans">{content}</pre>
      </div>
    </ProcessBlock>
  );
}

function ToolCard({ message, forceExpandTool = 0, onToggleGroup }: { message: ChatMessage, forceExpandTool?: number, onToggleGroup?: (isOpen: boolean) => void }) {
  const [globalExpanded, setGlobalExpanded] = useAtom(globalToolExpandedAtom);
  const [isOpen, setIsOpen] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (forceExpandTool > 0) setIsOpen(true);
    else if (forceExpandTool < 0) setIsOpen(false);
  }, [forceExpandTool]);

  const isInputStreaming = message.status === "streaming";
  const isToolRunning = message.toolStatus === "running";
  const isToolError = message.toolStatus === "error";

  const handleToggle = (e?: React.MouseEvent) => {
    const next = !isOpen;
    
    let scrollContainer: Element | null = null;
    let prevTop = 0;
    
    if (e?.currentTarget) {
      const container = e.currentTarget.closest('.custom-scrollbar');
      const itemRect = e.currentTarget.getBoundingClientRect();
      
      if (container) {
        scrollContainer = container;
        prevTop = itemRect.top;
      }
    }

    setIsOpen(next);
    setGlobalExpanded(next);
    
    if (onToggleGroup) {
      onToggleGroup(next);
    }

    if (scrollContainer && e?.currentTarget) {
      const target = e.currentTarget;
      requestAnimationFrame(() => {
        const newTop = target.getBoundingClientRect().top;
        const diff = newTop - prevTop;
        
        if (diff !== 0 && scrollContainer) {
          scrollContainer.scrollTop += diff;
        }
      });
    }
  };

  // Generate a brief summary for the collapsed state
  const summary = useMemo(() => {
    let result = "";
    if (message.toolInput) {
      try {
        const parsed = JSON.parse(message.toolInput);
        const toolName = message.toolName || "";
        if (toolName.includes("bash")) {
          result = parsed.command || parsed.description || "";
        } else if (toolName.includes("read") || toolName.includes("write")) {
          result = parsed.filePath ? parsed.filePath.split('/').pop() : "";
        } else if (toolName.includes("search") || toolName.includes("grep")) {
          result = parsed.query || parsed.pattern || "";
        } else {
          const val = Object.values(parsed).find(v => typeof v === 'string' && (v as string).trim().length > 0);
          result = val ? String(val) : "";
        }
      } catch {
        // JSON hasn't finished streaming, use raw text safely
        result = message.toolInput.replace(/["'{}]/g, "").trim();
      }
    }
    if (!result) result = "等待参数...";
    if (result.length > 50) result = result.slice(0, 50) + "...";
    return result;
  }, [message.toolInput, message.toolName]);

  const cleanToolName = message.toolName?.replace('default_api:', '') || 'Tool';
  const formattedToolName = cleanToolName.charAt(0).toUpperCase() + cleanToolName.slice(1);
  
  const displayTitle = (
    <>
      <span className="text-stone-700 font-medium leading-none">
        {formattedToolName}
      </span>
      <span className="text-stone-300 leading-none">·</span>
      <span className="text-stone-500 truncate max-w-[200px] sm:max-w-[400px] text-[13px] leading-none">{summary}</span>
      {isToolError && <span className="text-rose-500 text-xs ml-1 font-medium leading-none">失败</span>}
    </>
  );

  return (
    <ProcessBlock
      icon={
        isToolRunning ? (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-orange-500/30 border-t-orange-500" />
        ) : isToolError ? (
          <svg className="h-3.5 w-3.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="h-3 w-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12l3 3 5-5" />
          </svg>
        )
      }
      title={displayTitle}
      isStreaming={false} // Loading indicator is handled in the icon itself
      isOpen={isOpen}
      onToggle={handleToggle}
      variant="tool"
    >
      <div className="flex flex-col gap-4">
        {/* Input parameters */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">
            Input
          </div>
          <div className="text-[12px] leading-relaxed text-stone-600">
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11.5px]">
              {message.toolInput || "Waiting..."}
              {isInputStreaming ? (
                <span className="ml-[2px] inline-block animate-pulse text-stone-400">|</span>
              ) : null}
            </pre>
          </div>
        </div>

        {/* Output results */}
        {(message.toolResult || isToolError || (!isToolRunning && !message.toolResult)) && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-stone-400">
              Output
            </div>
            <div className={cn(
              "text-[12px] leading-relaxed",
              isToolError ? "text-rose-600" : "text-stone-600"
            )}>
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11.5px]">
                {message.toolResult || (isToolError ? "The tool returned an error." : "No output.")}
              </pre>
            </div>
          </div>
        )}
      </div>
    </ProcessBlock>
  );
}

/**
 * 单条消息组件
 * 渲染用户或助手的消息，包括思考内容和错误信息
 */
export const MessageItem = memo(function MessageItem({
  message,
  showAvatar = true,
  forceExpandTool = 0,
  onToolToggle
}: MessageItemProps) {
  const isUser = message.role === "user";
  const isThinkingMessage = message.type === "thinking" || Boolean(message.thinking);
  const isToolUse = message.type === "tool_use";
  
  // Using status === "streaming" handles both thinking and text streaming
  const isStreaming = message.status === "streaming";
  const hasText = Boolean(message.text);

  // For User Message
  if (isUser) {
    return (
      <article className="ml-auto mt-6 flex max-w-[80%] flex-col items-end">
        <div className="rounded-[20px] rounded-tr-[4px] bg-[#f0e8dc] px-4 py-2.5 text-stone-900 shadow-sm transition-all">
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed font-normal">
            {message.text}
          </div>
        </div>
      </article>
    );
  }

  // Agent Avatar and Title Header
  const AgentHeader = showAvatar ? (
    <div className="flex items-center gap-2 mb-2 mt-0.5">
      <span className="text-[14px] font-semibold text-stone-800 tracking-tight">Zora</span>
      <span className="text-[11px] font-medium text-stone-400 mt-[2px]">
        {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
      </span>
    </div>
  ) : null;

  // Spacing class
  const mtClass = showAvatar ? "mt-8" : "mt-1.5";

  // Tool rendering check
  if (isToolUse) {
    return (
      <article className={cn("mr-auto flex w-full max-w-[95%] items-start gap-4 group", mtClass)}>
        <div className="mt-1 shrink-0 w-8 flex justify-center transition-opacity">
          {showAvatar ? <ZoraAvatar /> : null}
        </div>
        
        <div className="flex-1 overflow-hidden w-full max-w-full">
          {AgentHeader}
          <ToolCard message={message} forceExpandTool={forceExpandTool} onToggleGroup={onToolToggle} />
        </div>
      </article>
    );
  }

  return (
    <article className={cn("mr-auto flex w-full max-w-[95%] items-start gap-4 group", mtClass)}>
      <div className="mt-1 shrink-0 w-8 flex justify-center transition-opacity">
        {showAvatar ? <ZoraAvatar /> : null}
      </div>
      
      <div className="flex-1 overflow-hidden w-full max-w-full">
        {AgentHeader}

        {isThinkingMessage ? (
          <ThinkingTrace 
            content={message.thinking} 
            // the trace is streaming only if we have no text yet AND the message overall is streaming
            isStreaming={isStreaming && !hasText} 
          />
        ) : null}

        {hasText ? (
          <div className={cn("text-[15px] leading-[1.6] text-stone-800 break-words", (showAvatar || isThinkingMessage) ? "mt-3" : "mt-0")}>
            <MarkdownMessage content={message.text} />
            {isStreaming && (
              <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-stone-300 align-middle"></span>
            )}
          </div>
        ) : null}

        {message.error ? (
          <div className="mt-3 rounded-xl bg-rose-50/80 px-4 py-3 text-[14px] leading-relaxed text-rose-800 ring-1 ring-rose-200/50">
            {message.error}
          </div>
        ) : null}
      </div>
    </article>
  );
});
