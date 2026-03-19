import { useState } from "react";
import type { ToolAction } from "../../types";
import { cn } from "../../utils/cn";
import { formatDuration } from "../../utils/duration";
import { formatToolName, getToolSummaryText } from "../../utils/toolSummary";
import { ElapsedTimer } from "./ElapsedTimer";

function formatToolInput(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

export function ToolStep({ tool }: { tool: ToolAction }) {
  const [isOpen, setIsOpen] = useState(false);
  const summaryText = getToolSummaryText(tool);
  const displayToolName = formatToolName(tool.name);
  const displayInput = formatToolInput(tool.input);
  const showSummary =
    summaryText.trim().length > 0 &&
    summaryText !== displayToolName &&
    summaryText !== tool.name;

  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="mx-[-6px] flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-200 hover:bg-stone-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        {tool.status === "running" ? (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-stone-300 border-t-stone-500 motion-reduce:animate-none" />
        ) : tool.status === "error" ? (
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        )}

        <span className="text-[12px] font-medium text-stone-600">{displayToolName}</span>

        {showSummary ? (
          <span className="max-w-[300px] truncate text-[12px] text-stone-400">
            · {summaryText}
          </span>
        ) : null}

        {tool.completedAt ? (
          <span className="ml-auto shrink-0 text-[11px] text-stone-300">
            {formatDuration(tool.completedAt - tool.startedAt)}
          </span>
        ) : tool.status === "running" ? (
          <ElapsedTimer
            startedAt={tool.startedAt}
            className="ml-auto shrink-0 text-[11px] text-stone-300"
          />
        ) : null}
      </button>

      {isOpen ? (
        <div className="ml-4 mt-1 rounded-lg border border-stone-100 bg-stone-50 p-2.5">
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
              input
            </div>
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-stone-600">
              {displayInput || "Waiting..."}
              {tool.status === "running" ? (
                <span className="ml-0.5 inline-block animate-pulse text-stone-400 motion-reduce:animate-none">
                  |
                </span>
              ) : null}
            </pre>
          </div>

          {tool.result ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
                output
              </div>
              <pre
                className={cn(
                  "m-0 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] custom-scrollbar",
                  tool.status === "error" ? "text-rose-600" : "text-stone-600"
                )}
              >
                {tool.result}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
