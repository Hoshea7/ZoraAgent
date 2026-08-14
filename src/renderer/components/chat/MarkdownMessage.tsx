import { useMemo, useState, type AnchorHTMLAttributes } from "react";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown, type Components } from "streamdown";
import { cn } from "../../utils/cn";
import { CheckIcon, CopyIcon } from "../ui/Icons";

export function CopyButton({ content, className }: { content: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch (error) {
          console.error("Failed to copy text", error);
        }
      }}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
        copied ? "text-emerald-500" : "text-stone-400 hover:bg-stone-200/50 hover:text-stone-600",
        className
      )}
      title="复制"
      aria-label={copied ? "已复制" : "复制"}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function ExternalLink({ href, children, target: _target, rel: _rel, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const external = Boolean(href && /^(https?:|mailto:)/i.test(href));
  return (
    <a
      {...props}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="font-medium text-stone-700 underline decoration-stone-300 underline-offset-2 hover:text-stone-950"
      onClick={(event) => {
        if (href && external) {
          event.preventDefault();
          void window.zora.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  );
}

const markdownComponents = {
  a: ExternalLink,
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-xl font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-2 min-w-0 break-words">{children}</p>,
  ul: ({ children, className }) => {
    const isTaskList = className?.includes("contains-task-list");
    return (
      <ul className={isTaskList ? "my-2 list-none space-y-1 pl-0" : "my-2 list-outside list-disc space-y-1 pl-6"}>
        {children}
      </ul>
    );
  },
  ol: ({ children }) => <ol className="my-2 list-outside list-decimal space-y-1 pl-8">{children}</ol>,
  li: ({ children }) => <li className="min-w-0 pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-stone-300 pl-4 text-stone-600">{children}</blockquote>
  ),
  table: ({ children }) => (
    <table data-table-variant="responsive" className="w-max min-w-full border-separate border-spacing-0 text-left text-[13px]">
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b border-stone-200 bg-stone-50 px-3 py-2 font-semibold text-stone-700">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="max-w-[480px] border-b border-stone-100 px-3 py-2 align-top [overflow-wrap:anywhere]">
      {children}
    </td>
  ),
  inlineCode: ({ children }) => (
    <code className="rounded bg-stone-100 px-1.5 py-0.5 text-[0.9em] text-stone-800">{children}</code>
  ),
} as Components;

export function MarkdownMessage({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const plugins = useMemo(() => ({ code, mermaid }), []);

  return (
    <Streamdown
      className="ai-message-content min-w-0 max-w-full overflow-x-hidden [&_[data-streamdown=table-wrapper]]:overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto"
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown
      animated={false}
      caret={undefined}
      controls={{
        table: { copy: true, download: false, fullscreen: true },
        code: { copy: true, download: false },
        mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
      }}
      components={markdownComponents}
      plugins={plugins}
    >
      {content}
    </Streamdown>
  );
}
