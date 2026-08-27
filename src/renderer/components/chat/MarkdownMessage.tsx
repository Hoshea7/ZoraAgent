import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type TableHTMLAttributes,
} from "react";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown, type Components } from "streamdown";
import { cn } from "../../utils/cn";
import { CheckIcon, CopyIcon } from "../ui/Icons";

const MAX_MARKDOWN_TABLE_WIDTH = 1180;
const STREAMING_WORD_ANIMATION = {
  animation: "fadeIn",
  duration: 120,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
  sep: "word",
  stagger: 4,
} as const;

export function resolveAdaptiveTableWidth(
  baseWidth: number,
  maxWidth: number,
  isCramped: (width: number) => boolean,
) {
  const lowerBound = Math.max(0, Math.round(baseWidth));
  const upperBound = Math.max(lowerBound, Math.round(maxWidth));

  if (lowerBound === upperBound || !isCramped(lowerBound)) {
    return lowerBound;
  }

  if (isCramped(upperBound)) {
    return upperBound;
  }

  let low = lowerBound;
  let high = upperBound;
  while (low + 1 < high) {
    const midpoint = Math.floor((low + high) / 2);
    if (isCramped(midpoint)) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return high;
}

function AdaptiveMarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { node?: unknown }) {
  const tableRef = useRef<HTMLTableElement | null>(null);

  useLayoutEffect(() => {
    const table = tableRef.current;
    const content = table?.closest(".ai-message-content");
    if (!table || !(content instanceof HTMLElement)) {
      return;
    }

    const updateWidth = () => {
      const baseWidth = Math.round(content.clientWidth);
      const availableWidth = Math.round(
        Math.min(
          MAX_MARKDOWN_TABLE_WIDTH,
          table.closest("article")?.clientWidth ?? baseWidth,
        ),
      );

      if (baseWidth <= 0 || availableWidth <= baseWidth) {
        table.style.width = "100%";
        return;
      }

      table.style.width = `${availableWidth}px`;
      const spaciousHeight = table.getBoundingClientRect().height;
      const toleratedExtraHeight = Math.max(20, spaciousHeight * 0.08);
      const resolvedWidth = resolveAdaptiveTableWidth(
        baseWidth,
        availableWidth,
        (candidateWidth) => {
          table.style.width = `${candidateWidth}px`;
          return table.getBoundingClientRect().height > spaciousHeight + toleratedExtraHeight;
        },
      );

      table.style.width = resolvedWidth <= baseWidth ? "100%" : `${resolvedWidth}px`;
    };

    updateWidth();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWidth);
    resizeObserver?.observe(content);
    const article = table.closest("article");
    if (article) {
      resizeObserver?.observe(article);
    }

    return () => resizeObserver?.disconnect();
  }, [children]);

  return (
    <table
      ref={tableRef}
      data-table-variant="responsive"
      className={cn(
        "relative left-1/2 w-full min-w-full max-w-[min(100cqi,1180px)] -translate-x-1/2 table-auto border-collapse text-left text-[15px] leading-[1.55]",
        className,
      )}
      {...props}
    >
      {children}
    </table>
  );
}

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
      className="font-medium text-[var(--color-brand)] underline decoration-[var(--color-brand-muted)] underline-offset-2 transition-colors hover:text-[#a85f37]"
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
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-[24px] font-semibold leading-[1.25] text-[#211d19]">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-[20px] font-semibold leading-[1.32] text-[#211d19]">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-[17px] font-semibold leading-[1.36] text-[#211d19]">{children}</h3>,
  p: ({ children }) => <p className="my-2 min-w-0 break-words text-[#332f2a]">{children}</p>,
  ul: ({ children, className }) => {
    const isTaskList = className?.includes("contains-task-list");
    return (
      <ul className={isTaskList ? "my-2 list-none space-y-2.5 pl-0" : "my-2 list-outside list-disc space-y-2 pl-6 marker:text-[var(--color-brand-muted)]"}>
        {children}
      </ul>
    );
  },
  ol: ({ children }) => <ol className="my-2 list-outside list-decimal space-y-2 pl-8 marker:font-semibold marker:text-[var(--color-brand)]">{children}</ol>,
  li: ({ children }) => <li className="min-w-0 pl-1 leading-[1.72] text-[#332f2a] [&>p]:my-0">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-r-[18px] border-l-[3px] border-[var(--color-brand-muted)] bg-[#fbf5ee] px-4 py-3 text-[#5c554d]">{children}</blockquote>
  ),
  hr: () => <hr className="border-0 border-t border-stone-200/80" />,
  strong: ({ children }) => <strong className="font-semibold text-[#211d19]">{children}</strong>,
  table: AdaptiveMarkdownTable,
  th: ({ children }) => (
    <th className="min-w-0 border-b border-stone-200 bg-stone-50 px-[clamp(8px,2cqi,14px)] py-[clamp(7px,1.4cqi,10px)] align-bottom font-semibold text-stone-700 break-words [overflow-wrap:anywhere]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="min-w-0 border-b border-stone-100 px-[clamp(8px,2cqi,14px)] py-[clamp(7px,1.4cqi,10px)] align-top break-words [overflow-wrap:anywhere]">
      {children}
    </td>
  ),
  inlineCode: ({ children }) => (
    <code className="rounded bg-[#f7eee7] px-1.5 py-0.5 text-[0.9em] text-[#8f4f2f]">{children}</code>
  ),
} as Components;

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const plugins = useMemo(() => ({ code, mermaid }), []);
  return (
    <Streamdown
      className="ai-message-content min-w-0 max-w-full overflow-visible [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:overflow-hidden [&_[data-streamdown=code-block]]:rounded-xl [&_[data-streamdown=code-block]]:border-stone-200/80 [&_[data-streamdown=code-block]]:bg-stone-50 [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block]]:shadow-sm [&_[data-streamdown=code-block-header]]:h-9 [&_[data-streamdown=code-block-header]]:border-b [&_[data-streamdown=code-block-header]]:border-stone-200/80 [&_[data-streamdown=code-block-header]]:bg-stone-100 [&_[data-streamdown=code-block-header]]:px-3 [&_[data-streamdown=code-block-body]]:max-w-full [&_[data-streamdown=code-block-body]]:overflow-x-auto [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-4 [&_[data-streamdown=code-block-body]]:text-[13.5px] [&_[data-streamdown=code-block-body]]:leading-[1.6] [&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-transparent [&_[data-streamdown=code-block-actions]]:p-0 [&_[data-streamdown=code-block-actions]]:shadow-none [&_pre]:max-w-full"
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown
      animated={isStreaming ? STREAMING_WORD_ANIMATION : false}
      isAnimating={isStreaming}
      caret={undefined}
      lineNumbers={false}
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
});
