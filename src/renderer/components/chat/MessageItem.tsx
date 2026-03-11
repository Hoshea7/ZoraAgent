import { useState, useEffect } from "react";
import type { ChatMessage } from "../../types";
import { cn } from "../../utils/cn";

export interface MessageItemProps {
  message: ChatMessage;
}

// Zora Avatar Icon
function ZoraAvatar() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100/80 text-orange-600 shadow-sm ring-1 ring-orange-200/50">
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

function ThinkingTrace({ content, isStreaming }: { content: string, isStreaming: boolean }) {
  const [isOpen, setIsOpen] = useState(isStreaming);

  // When streaming stops, auto-collapse
  useEffect(() => {
    if (!isStreaming) {
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  }, [isStreaming]);

  if (!isOpen) {
    return (
      <div 
        className="mb-2 mt-1 flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-stone-400 hover:text-stone-600 transition-colors w-fit"
        onClick={() => setIsOpen(true)}
      >
        <span>● 思考过程</span>
        <svg className="h-3 w-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    );
  }

  return (
    <div className="mb-3 mt-1 overflow-hidden rounded-[18px] bg-stone-50/80 text-stone-700 ring-1 ring-stone-200/50 transition-all">
      <div 
        className="flex cursor-pointer items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium text-stone-500 hover:bg-stone-100/50 transition-colors"
        onClick={() => setIsOpen(false)}
      >
        {isStreaming ? (
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 items-center justify-center">
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-stone-400 opacity-75"></span>
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-stone-500"></span>
            </span>
            <span>思考中...</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 w-full">
            <span>● 思考过程</span>
            <svg className="h-3 w-3 opacity-70 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        )}
      </div>
      <div className="border-t border-stone-200/40 px-3.5 pb-3.5 pt-2.5 text-[13.5px] leading-relaxed text-stone-500 max-h-[400px] overflow-y-auto">
        <pre className="m-0 whitespace-pre-wrap font-sans">{content}</pre>
      </div>
    </div>
  );
}

function ToolCard({ message }: MessageItemProps) {
  const isInputStreaming = message.status === "streaming";
  const isToolRunning = message.toolStatus === "running";
  const isToolError = message.toolStatus === "error";

  return (
    <article className="ml-10 mr-auto mt-2 mb-3 flex w-full max-w-[85%] flex-col overflow-hidden rounded-[16px] bg-white ring-1 ring-stone-200/60 shadow-sm transition-all">
      <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/50 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-white text-stone-500 ring-1 ring-stone-200/80 shadow-sm">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <span className="text-[13px] font-medium text-stone-700">
            {message.toolName ?? "Tool"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[12px] font-medium">
          {isToolRunning ? (
            <span className="flex items-center gap-1.5 text-amber-600">
              <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-600" />
              Running
            </span>
          ) : isToolError ? (
            <span className="text-rose-600">Failed</span>
          ) : (
            <span className="text-stone-400">Completed</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {/* Input parameters */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">
            Input
          </div>
          <div className="rounded-lg bg-stone-50 px-3 py-2 text-[12px] leading-relaxed text-stone-600">
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px]">
              {message.toolInput || "Waiting..."}
              {isInputStreaming ? (
                <span className="ml-[2px] inline-block animate-pulse text-stone-400">|</span>
              ) : null}
            </pre>
          </div>
        </div>

        {/* Output results */}
        {(message.toolResult || isToolError || (!isToolRunning && !message.toolResult)) && (
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">
              Output
            </div>
            <div className={cn(
              "rounded-lg px-3 py-2 text-[12px] leading-relaxed",
              isToolError ? "bg-rose-50/50 text-rose-700" : "bg-stone-50 text-stone-600"
            )}>
              <pre className="m-0 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                {message.toolResult || (isToolError ? "The tool returned an error." : "No output.")}
              </pre>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * 单条消息组件
 * 渲染用户或助手的消息，包括思考内容和错误信息
 */
export function MessageItem({ message }: MessageItemProps) {
  if (message.type === "tool_use") {
    return <ToolCard message={message} />;
  }

  const isUser = message.role === "user";
  const isThinkingMessage = message.type === "thinking" || Boolean(message.thinking);
  // Using status === "streaming" handles both thinking and text streaming
  const isStreaming = message.status === "streaming";
  const hasText = Boolean(message.text);

  // For User Message
  if (isUser) {
    return (
      <article className="ml-auto mt-6 flex max-w-[80%] flex-col items-end">
        <div className="rounded-[24px] rounded-tr-[8px] bg-[#e6e2da] px-5 py-3 text-stone-900 shadow-[0_2px_4px_rgba(0,0,0,0.02)] transition-all">
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed font-normal">
            {message.text}
          </div>
        </div>
      </article>
    );
  }

  // For Agent Message
  return (
    <article className="mr-auto mt-6 flex max-w-[90%] items-start gap-3.5 group">
      <div className="mt-1 shrink-0 transition-opacity">
        <ZoraAvatar />
      </div>
      
      <div className="flex-1 overflow-hidden pt-1 w-full max-w-full">
        {isThinkingMessage ? (
          <ThinkingTrace 
            content={message.thinking} 
            // the trace is streaming only if we have no text yet AND the message overall is streaming
            isStreaming={isStreaming && !hasText} 
          />
        ) : null}

        {hasText ? (
          <div className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-800 break-words">
            {message.text}
            {isStreaming && (
              <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-stone-300 align-middle"></span>
            )}
          </div>
        ) : null}

        {!isThinkingMessage && !hasText && isStreaming ? (
          <div className="mt-2.5 flex items-center gap-1.5 text-[15px] text-stone-400">
            <span className="flex h-1.5 w-1.5 items-center justify-center">
              <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-stone-300 opacity-75"></span>
              <span className="relative inline-flex h-1 w-1 rounded-full bg-stone-400"></span>
            </span>
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
}
