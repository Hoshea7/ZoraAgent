import { useState } from "react";
import type { ToolAction } from "../../types";
import { cn } from "../../utils/cn";
import { formatDuration } from "../../utils/duration";
import { formatToolName, getToolSummaryText } from "../../utils/toolSummary";
import { captureViewportAnchor } from "../../utils/scrollAnchor";
import { ElapsedTimer } from "./ElapsedTimer";

function basename(value: string): string {
  return value.split(/[/\\]/).filter(Boolean).at(-1) ?? value;
}

export function formatToolInput(input: string, toolName: string): string {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (
      toolName.toLowerCase() === "read" &&
      typeof parsed === "object" &&
      parsed !== null
    ) {
      const sanitized = { ...(parsed as Record<string, unknown>) };
      for (const key of ["file_path", "path", "filePath"] as const) {
        if (typeof sanitized[key] === "string") {
          sanitized[key] = basename(sanitized[key]);
        }
      }
      return JSON.stringify(sanitized, null, 2);
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return input;
  }
}

function formatDisplayToolName(toolName: string): string {
  const formattedName = formatToolName(toolName);
  if (formattedName === "Inspect Image") {
    return formattedName;
  }

  const match = /^mcp__([^_].*?)__([^_].+)$/.exec(toolName);
  if (!match) {
    return formattedName;
  }

  return `MCP · ${match[1]} / ${match[2]}`;
}

export function ToolStep({ tool }: { tool: ToolAction }) {
  const [isOpen, setIsOpen] = useState(false);
  const summaryText = getToolSummaryText(tool);
  const displayToolName = formatDisplayToolName(tool.name);
  const displayInput = formatToolInput(tool.input, tool.name);

  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={(event) => {
          const restoreAnchor = captureViewportAnchor(event.currentTarget);
          setIsOpen((current) => !current);
          requestAnimationFrame(restoreAnchor);
        }}
        title={summaryText !== displayToolName ? summaryText : undefined}
        className="flex w-full items-center gap-1.5 py-0.5 text-left text-[11.5px] leading-[18px] transition-colors duration-200 hover:text-stone-700 focus-visible:text-stone-700 focus-visible:underline focus-visible:underline-offset-2 focus-visible:outline-none"
      >
        <span className="flex h-2 w-2 shrink-0 items-center justify-center animate-trace-status-in motion-reduce:animate-none">
          {tool.status === "running" ? (
            <span className="h-2 w-2 animate-spin rounded-full border border-stone-300 border-t-stone-500 motion-reduce:animate-none" />
          ) : tool.status === "error" ? (
            <span className="h-2 w-2 rounded-full bg-rose-400" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          )}
        </span>

        <span className="font-[430] text-[#645c54]">{displayToolName}</span>

        {tool.completedAt ? (
          <span className="shrink-0 text-[11px] tabular-nums text-[#c7c0ba]">
            {formatDuration(tool.completedAt - tool.startedAt)}
          </span>
        ) : tool.status === "running" ? (
          <ElapsedTimer
            startedAt={tool.startedAt}
            className="shrink-0 text-[11px] text-[#c7c0ba]"
          />
        ) : null}
      </button>

      {isOpen ? (
        <div className="min-h-0 overflow-hidden">
          <div className="ml-4 mt-1 rounded-lg border border-stone-100 bg-stone-50 p-2.5">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-medium text-stone-400">
                输入
              </div>
              <pre className="ai-process-mono m-0 whitespace-pre-wrap break-words text-[11px] text-stone-600">
                {displayInput || "等待中…"}
                {tool.status === "running" ? (
                  <span className="ml-0.5 inline-block animate-pulse text-stone-400 motion-reduce:animate-none">
                    |
                  </span>
                ) : null}
              </pre>
            </div>

            {tool.result ? (
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="text-[10px] font-medium text-stone-400">
                  输出
                </div>
                <pre
                  data-testid="tool-output"
                  className={cn(
                    "ai-process-mono m-0 whitespace-pre-wrap break-words text-[11px] [overflow-wrap:anywhere]",
                    tool.status === "error" ? "text-rose-600" : "text-stone-600"
                  )}
                >
                  {tool.result}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
