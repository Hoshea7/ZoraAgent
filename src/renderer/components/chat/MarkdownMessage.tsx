import { memo, useMemo, useState, useEffect, useRef, createContext, useContext, type ComponentPropsWithoutRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkToc from "remark-toc";
import rehypeSlug from "rehype-slug";
import { cn } from "../../utils/cn";

type MarkdownMessageProps = {
  content: string;
};

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  node?: unknown;
};

type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & {
  children?: ReactNode;
  node?: unknown;
};

type SyntaxHighlighterAssets = {
  SyntaxHighlighter: typeof import("react-syntax-highlighter")["Prism"];
  syntaxTheme: Record<string, CSSProperties>;
};

type SvgSize = {
  width: number;
  height: number;
};

type TableVariant = "compact" | "regular" | "wide";

type TableContextValue = {
  inTable: boolean;
  variant: TableVariant;
};

type TableMetrics = {
  averageCellUnits: number;
  columnCount: number;
  maxCellUnits: number;
  rowCount: number;
};

type TablePresentation = {
  cellContentClassName: string;
  scrollerClassName: string;
  shellClassName: string;
  tableClassName: string;
  tdClassName: string;
  thClassName: string;
};

type TableScrollState = {
  atEnd: boolean;
  atStart: boolean;
  canScroll: boolean;
};

const TABLE_PRESENTATION = {
  compact: {
    shellClassName: "w-full max-w-full",
    scrollerClassName: "w-full",
    tableClassName:
      "w-full min-w-full table-fixed border-collapse text-center text-[15px] leading-[1.58] [font-family:var(--font-family-chat)]",
    thClassName:
      "border-b border-stone-200 px-4 py-2.5 align-top font-semibold text-stone-700",
    tdClassName: "px-4 py-2.5 align-top text-[#4b443d]",
    cellContentClassName:
      "mx-auto w-full min-w-0 max-w-full whitespace-normal break-words text-center [overflow-wrap:anywhere] [word-break:break-word]"
  },
  regular: {
    shellClassName: "w-full max-w-full",
    scrollerClassName: "w-full",
    tableClassName:
      "w-full min-w-full table-fixed border-collapse text-left text-[15px] leading-[1.58] [font-family:var(--font-family-chat)]",
    thClassName:
      "border-b border-stone-200 px-3.5 py-2.5 align-top font-semibold text-stone-700",
    tdClassName: "px-3.5 py-2.5 align-top text-[#4b443d]",
    cellContentClassName:
      "w-full min-w-0 max-w-none whitespace-normal break-words text-left [overflow-wrap:anywhere] [word-break:break-word]"
  },
  wide: {
    shellClassName: "w-full max-w-full",
    scrollerClassName: "w-full",
    tableClassName:
      "w-max min-w-full max-w-none border-collapse table-auto text-left text-[15px] leading-[1.58] [font-family:var(--font-family-chat)]",
    thClassName:
      "border-b border-stone-200 px-3 py-2.5 align-top font-semibold text-stone-700",
    tdClassName: "px-3 py-2.5 align-top text-[#4b443d]",
    cellContentClassName:
      "w-full min-w-[8rem] max-w-[min(18rem,58vw)] whitespace-normal break-words text-left [overflow-wrap:anywhere] [word-break:break-word]"
  }
} as const satisfies Record<TableVariant, TablePresentation>;

const DEFAULT_TABLE_CONTEXT: TableContextValue = {
  inTable: false,
  variant: "regular"
};

const INITIAL_TABLE_SCROLL_STATE: TableScrollState = {
  atEnd: true,
  atStart: true,
  canScroll: false
};

const TableContext = createContext<TableContextValue>(DEFAULT_TABLE_CONTEXT);
const MERMAID_DISALLOWED_TAGS = ["script", "foreignObject", "iframe", "object", "embed"] as const;
const MERMAID_URL_ATTRS = new Set(["href", "xlink:href"]);
const CODE_FONT_FAMILY =
  '"SFMono-Regular", "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace';
const MERMAID_CONFIG = {
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  fontFamily: "inherit"
} as const;
const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

let syntaxHighlighterAssetsPromise: Promise<SyntaxHighlighterAssets> | null = null;
let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getAstTagName(node: unknown) {
  if (!isRecord(node) || typeof node.tagName !== "string") {
    return null;
  }

  return node.tagName.toLowerCase();
}

function getAstChildren(node: unknown) {
  if (!isRecord(node) || !Array.isArray(node.children)) {
    return [];
  }

  return node.children;
}

function getAstText(node: unknown): string {
  if (!isRecord(node)) {
    return "";
  }

  if (typeof node.value === "string") {
    return node.value;
  }

  return getAstChildren(node).map(getAstText).join("");
}

function normalizeCellText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function estimateTextUnits(text: string) {
  return Array.from(text).reduce((units, character) => {
    return units + (/[^\x00-\xff]/.test(character) ? 1 : 0.58);
  }, 0);
}

function shouldCenterTableCell(variant: TableVariant, text: string) {
  if (variant === "compact") {
    return estimateTextUnits(normalizeCellText(text)) <= 9;
  }

  const normalizedText = normalizeCellText(text);
  if (!normalizedText) {
    return true;
  }

  return (
    /^[-–—]+$/.test(normalizedText) ||
    /^[★☆⭐✦✧]+$/.test(normalizedText) ||
    /^(投递|详情|查看|打开)$/.test(normalizedText) ||
    /^[~≈]?\d[\d\s:：.,，/%~+\-–—/]*%?$/.test(normalizedText)
  );
}

function collectTableRows(node: unknown) {
  const rows: string[][] = [];

  function visit(currentNode: unknown) {
    if (getAstTagName(currentNode) === "tr") {
      const cells = getAstChildren(currentNode)
        .filter((child) => {
          const tagName = getAstTagName(child);
          return tagName === "th" || tagName === "td";
        })
        .map((cell) => normalizeCellText(getAstText(cell)));

      if (cells.length > 0) {
        rows.push(cells);
      }
      return;
    }

    getAstChildren(currentNode).forEach(visit);
  }

  visit(node);
  return rows;
}

function getTableMetrics(node: unknown): TableMetrics {
  const rows = collectTableRows(node);
  const cells = rows.flat();
  const cellUnits = cells.map(estimateTextUnits);
  const totalUnits = cellUnits.reduce((sum, units) => sum + units, 0);

  return {
    averageCellUnits: cellUnits.length > 0 ? totalUnits / cellUnits.length : 0,
    columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
    maxCellUnits: cellUnits.length > 0 ? Math.max(...cellUnits) : 0,
    rowCount: rows.length
  };
}

function getTableVariant(metrics: TableMetrics): TableVariant {
  if (
    metrics.columnCount > 0 &&
    metrics.columnCount <= 4 &&
    metrics.maxCellUnits <= 18 &&
    metrics.averageCellUnits <= 11
  ) {
    return "compact";
  }

  if (
    metrics.columnCount >= 6 ||
    metrics.columnCount * Math.max(metrics.averageCellUnits, 1) >= 90
  ) {
    return "wide";
  }

  return "regular";
}

function buildSyntaxTheme(baseTheme: Record<string, CSSProperties>) {
  return {
    ...baseTheme,
    'pre[class*="language-"]': {
      ...(baseTheme['pre[class*="language-"]'] ?? {}),
      background: "transparent",
      margin: 0,
      padding: 0
    },
    'code[class*="language-"]': {
      ...(baseTheme['code[class*="language-"]'] ?? {}),
      background: "transparent"
    }
  } as const satisfies Record<string, CSSProperties>;
}

function getCodeBlockStyle(inTable: boolean): CSSProperties {
  return {
    margin: 0,
    padding: inTable ? "0.6rem 0.75rem" : "1rem",
    backgroundColor: "transparent",
    fontSize: inTable ? "12.5px" : "13.5px",
    lineHeight: 1.6,
    overflowX: "auto"
  };
}

function loadSyntaxHighlighterAssets() {
  if (!syntaxHighlighterAssetsPromise) {
    syntaxHighlighterAssetsPromise = Promise.all([
      import("react-syntax-highlighter"),
      import("react-syntax-highlighter/dist/esm/styles/prism/one-light"),
    ]).then(([syntaxHighlighterModule, themeModule]) => ({
      SyntaxHighlighter: syntaxHighlighterModule.Prism,
      syntaxTheme: buildSyntaxTheme(
        themeModule.default as Record<string, CSSProperties>
      )
    }));
  }

  return syntaxHighlighterAssetsPromise;
}

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mermaidModule) => {
      const mermaid = mermaidModule.default;
      mermaid.initialize(MERMAID_CONFIG);
      return mermaid;
    });
  }

  return mermaidPromise;
}

function isExternalHref(href: string | undefined): href is string {
  if (!href) {
    return false;
  }

  try {
    return EXTERNAL_LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

function openMarkdownLink(event: ReactMouseEvent<HTMLAnchorElement>, href: string | undefined) {
  if (!isExternalHref(href)) {
    return;
  }

  event.preventDefault();
  window.zora.openExternal(href).catch((error) => {
    console.error("Failed to open external link:", error);
  });
}

function sanitizeMermaidSvg(svg: string) {
  if (typeof DOMParser === "undefined") {
    return null;
  }

  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return null;
  }

  doc.querySelectorAll(MERMAID_DISALLOWED_TAGS.join(",")).forEach((node) => node.remove());

  doc.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      const attributeValue = attribute.value.trim().toLowerCase();

      if (attributeName.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (
        MERMAID_URL_ATTRS.has(attributeName) &&
        attributeValue !== "" &&
        !attributeValue.startsWith("#")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return doc.documentElement.tagName.toLowerCase() === "svg" ? doc.documentElement.outerHTML : null;
}

function getSvgSize(svg: string): SvgSize | null {
  if (typeof DOMParser === "undefined") {
    return null;
  }

  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return null;
  }

  const svgElement = doc.documentElement;
  const viewBox = svgElement.getAttribute("viewBox");

  if (viewBox) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value));

    if (values.length === 4 && values[2] > 0 && values[3] > 0) {
      return {
        width: values[2],
        height: values[3]
      };
    }
  }

  const width = Number.parseFloat(svgElement.getAttribute("width") ?? "");
  const height = Number.parseFloat(svgElement.getAttribute("height") ?? "");

  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }

  return null;
}

async function renderMermaidSvg(code: string, renderId: string) {
  const cleanCode = code.trim();
  const mermaid = await loadMermaid();
  const { svg } = await mermaid.render(renderId, cleanCode);
  const sanitizedSvg = sanitizeMermaidSvg(svg);

  if (!sanitizedSvg || svg.includes("Syntax error")) {
    throw new Error("Mermaid rendering rejected");
  }

  return sanitizedSvg;
}

export function CopyButton({ content, className }: { content: string, className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
        copied ? "text-emerald-500" : "text-stone-400 hover:bg-stone-200/50 hover:text-stone-600",
        className
      )}
      title="复制"
    >
      {copied ? (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

function CodeBlockFrame({
  code,
  inTable,
  label,
  children
}: {
  code: string;
  inTable: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="relative group overflow-hidden rounded-xl border border-stone-200/80 bg-stone-50 shadow-sm"
    >
      {!inTable && (
        <div className="flex items-center justify-between border-b border-stone-200/80 bg-stone-100 px-4 py-2">
          <span className="text-[12px] font-medium text-stone-500">
            {label}
          </span>
          <CopyButton content={code} />
        </div>
      )}
      {inTable && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <CopyButton
            content={code}
            className="bg-white/80 backdrop-blur-sm border border-stone-200/50 shadow-sm"
          />
        </div>
      )}
      {children}
    </div>
  );
}

function PlainCodeBlock({
  code,
  inTable,
  label
}: {
  code: string;
  inTable: boolean;
  label: string;
}) {
  return (
    <CodeBlockFrame code={code} inTable={inTable} label={label}>
      <pre
        className="text-stone-700"
        style={getCodeBlockStyle(inTable)}
      >
        <code style={{ fontFamily: CODE_FONT_FAMILY }}>
          {code}
        </code>
      </pre>
    </CodeBlockFrame>
  );
}

function HighlightedCodeBlock({
  code,
  inTable,
  language
}: {
  code: string;
  inTable: boolean;
  language: string;
}) {
  const [assets, setAssets] = useState<SyntaxHighlighterAssets | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void loadSyntaxHighlighterAssets()
      .then((loadedAssets) => {
        if (isMounted) {
          setAssets(loadedAssets);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoadFailed(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!assets || loadFailed) {
    return (
      <PlainCodeBlock
        code={code}
        inTable={inTable}
        label={loadFailed ? `${language} (plain text)` : language}
      />
    );
  }

  const { SyntaxHighlighter, syntaxTheme } = assets;

  return (
    <CodeBlockFrame code={code} inTable={inTable} label={language}>
      <SyntaxHighlighter
        language={language}
        style={syntaxTheme}
        PreTag="div"
        customStyle={getCodeBlockStyle(inTable)}
        codeTagProps={{
          style: {
            fontFamily: CODE_FONT_FAMILY
          }
        }}
      >
        {code}
      </SyntaxHighlighter>
    </CodeBlockFrame>
  );
}

function MarkdownTable({ children, className, node, ...props }: MarkdownTableProps) {
  const metrics = useMemo(() => getTableMetrics(node), [node]);
  const variant = getTableVariant(metrics);
  const presentation = TABLE_PRESENTATION[variant];
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState<TableScrollState>(INITIAL_TABLE_SCROLL_STATE);
  const contextValue = useMemo<TableContextValue>(
    () => ({
      inTable: true,
      variant
    }),
    [variant]
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    let frameId = 0;
    const updateScrollState = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
        setScrollState({
          atEnd: scroller.scrollLeft >= maxScrollLeft - 1,
          atStart: scroller.scrollLeft <= 1,
          canScroll: maxScrollLeft > 1
        });
      });
    };

    updateScrollState();
    scroller.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollState) : null;
    resizeObserver?.observe(scroller);

    if (scroller.firstElementChild) {
      resizeObserver?.observe(scroller.firstElementChild);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      scroller.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      resizeObserver?.disconnect();
    };
  }, [metrics.columnCount, metrics.maxCellUnits, metrics.rowCount, variant]);

  return (
    <TableContext.Provider value={contextValue}>
      <div className={cn("relative my-1", presentation.shellClassName)} data-table-variant={variant}>
        <div
          ref={scrollerRef}
          aria-label={scrollState.canScroll ? "Markdown 表格，可横向滚动" : undefined}
          tabIndex={scrollState.canScroll ? 0 : undefined}
          className={cn(
            "custom-scrollbar max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white shadow-sm outline-none focus-ring-sm",
            presentation.scrollerClassName
          )}
        >
          <table className={cn(presentation.tableClassName, className)} {...props}>
            {children}
          </table>
        </div>

        {scrollState.canScroll && !scrollState.atStart ? (
          <div className="pointer-events-none absolute inset-y-px left-px w-8 rounded-l-xl bg-gradient-to-r from-white via-white/85 to-transparent" />
        ) : null}

        {scrollState.canScroll && !scrollState.atEnd ? (
          <div className="pointer-events-none absolute inset-y-px right-px w-8 rounded-r-xl bg-gradient-to-l from-white via-white/85 to-transparent" />
        ) : null}
      </div>
    </TableContext.Provider>
  );
}

function MermaidBlock({ code }: { code: string }) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [hasError, setHasError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSvgContent, setFullscreenSvgContent] = useState<string>("");
  const [isFullscreenLoading, setIsFullscreenLoading] = useState(false);
  const [fullscreenRenderFailed, setFullscreenRenderFailed] = useState(false);
  const { inTable } = useContext(TableContext);
  const previewIdRef = useRef(`mermaid-preview-${Math.random().toString(36).slice(2, 11)}`);
  const fullscreenIdRef = useRef(`mermaid-fullscreen-${Math.random().toString(36).slice(2, 11)}`);
  const fullscreenSvgSize = useMemo(
    () => getSvgSize(fullscreenSvgContent || svgContent),
    [fullscreenSvgContent, svgContent]
  );
  const fullscreenWidth = useMemo(() => {
    if (!fullscreenSvgSize) {
      return "min(calc(100vw - 5rem), 72rem)";
    }

    return `min(calc(100vw - 5rem), max(${Math.ceil(fullscreenSvgSize.width)}px, 72rem))`;
  }, [fullscreenSvgSize]);

  useEffect(() => {
    let isMounted = true;
    setHasError(false);
    setSvgContent("");
    setFullscreenSvgContent("");
    setFullscreenRenderFailed(false);

    const renderMermaid = async () => {
      try {
        const sanitizedSvg = await renderMermaidSvg(code, previewIdRef.current);

        if (isMounted) {
          setSvgContent(sanitizedSvg);
        }
      } catch {
        if (isMounted) {
          setHasError(true);
          setSvgContent("");
        }
      }
    };

    const timer = setTimeout(renderMermaid, 300);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [code]);

  useEffect(() => {
    if (!isFullscreen || !svgContent) {
      return;
    }

    let isMounted = true;
    const renderId = `${fullscreenIdRef.current}-${Date.now().toString(36)}`;

    setIsFullscreenLoading(true);
    setFullscreenSvgContent("");
    setFullscreenRenderFailed(false);

    void renderMermaidSvg(code, renderId)
      .then((renderedSvg) => {
        if (isMounted) {
          setFullscreenSvgContent(renderedSvg);
        }
      })
      .catch(() => {
        if (isMounted) {
          setFullscreenSvgContent("");
          setFullscreenRenderFailed(true);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsFullscreenLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [code, isFullscreen, svgContent]);

  useEffect(() => {
    if (!isFullscreen || typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  if (hasError || !svgContent) {
    return (
      <PlainCodeBlock
        code={code}
        inTable={inTable}
        label={hasError ? "mermaid (failed to render)" : "mermaid (rendering...)"}
      />
    );
  }

  const content = (
    <div dangerouslySetInnerHTML={{ __html: svgContent }} className="[&>svg]:max-w-full [&>svg]:h-auto" />
  );

  const fullscreenModal = isFullscreen && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[200] bg-white/92 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="时序图全屏预览"
          onClick={() => setIsFullscreen(false)}
        >
          <button
            className="fixed right-6 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-stone-200/80 bg-white/95 text-stone-600 shadow-lg transition-colors hover:bg-white hover:text-stone-900"
            onClick={(event) => {
              event.stopPropagation();
              setIsFullscreen(false);
            }}
            title="关闭全屏"
            aria-label="关闭全屏"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="h-full w-full overflow-auto px-6 py-8 sm:px-10 sm:py-12" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-full items-center justify-center">
              {isFullscreenLoading ? (
                <div className="rounded-3xl border border-stone-200/80 bg-white px-6 py-4 text-sm text-stone-500 shadow-xl">
                  正在放大时序图...
                </div>
              ) : fullscreenRenderFailed || !fullscreenSvgContent ? (
                <div className="rounded-3xl border border-rose-200/80 bg-white px-6 py-4 text-sm text-rose-600 shadow-xl">
                  时序图放大失败，请关闭后重试。
                </div>
              ) : (
                <div
                  className="rounded-[28px] border border-stone-200/80 bg-white p-5 shadow-[0_24px_80px_rgba(28,25,23,0.12)] sm:p-7"
                  style={{ width: fullscreenWidth, minWidth: "20rem" }}
                >
                  <div
                    dangerouslySetInnerHTML={{ __html: fullscreenSvgContent }}
                    className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-none"
                  />
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {fullscreenModal}

      <div
        className="relative group cursor-pointer overflow-x-auto rounded-xl border border-stone-200/80 bg-white p-4 shadow-sm transition-colors hover:border-stone-300"
        onClick={() => setIsFullscreen(true)}
      >
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); setIsFullscreen(true); }}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80 backdrop-blur-sm border border-stone-200/50 shadow-sm text-stone-500 hover:text-stone-800 hover:bg-stone-50 transition-colors"
            title="全屏查看"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <div onClick={(e) => e.stopPropagation()}>
            <CopyButton content={code} className="bg-white/80 backdrop-blur-sm border border-stone-200/50 shadow-sm" />
          </div>
        </div>
        {content}
      </div>
    </>
  );
}

const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1
      className="text-[24px] font-semibold leading-[1.25] text-[#211d19]"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="text-[20px] font-semibold leading-[1.32] text-[#211d19]"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="text-[17px] font-semibold leading-[1.36] text-[#211d19]"
      {...props}
    >
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="leading-[1.72] text-[#332f2a]" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, className, ...props }) => (
    <ul
      className={cn(
        "list-outside list-disc space-y-2 pl-6 marker:text-orange-300",
        className?.includes("contains-task-list") ? "list-none space-y-2.5 pl-0" : ""
      )}
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, className, ...props }) => (
    <ol
      className={cn(
        "list-outside list-decimal space-y-2 pl-8 marker:font-medium marker:text-orange-400",
        className?.includes("contains-task-list") ? "list-none space-y-2.5 pl-0" : ""
      )}
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }) => (
    <li
      className={cn(
        "pl-1 leading-[1.72] text-[#332f2a] [&>p]:mb-0",
        className?.includes("task-list-item") ? "list-none pl-0" : ""
      )}
      {...props}
    >
      {children}
    </li>
  ),
  a: ({ href, children, ...props }) => {
    const isExternal = isExternalHref(href);

    return (
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer" : undefined}
        onClick={(event) => openMarkdownLink(event, href)}
        className="font-medium text-orange-700 underline decoration-orange-200 underline-offset-[0.22em] transition-colors hover:text-orange-800 hover:decoration-orange-400"
        {...props}
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="rounded-r-[18px] border-l-[3px] border-orange-300/80 bg-[#fbf5ee] px-4 py-3 text-[#5c554d]"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className="border-0 border-t border-stone-200/80" {...props} />,
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-[#211d19]" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="text-[#403a33]" {...props}>
      {children}
    </em>
  ),
  table: ({ children, node, ...props }) => (
    <MarkdownTable node={node} {...props}>
      {children}
    </MarkdownTable>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-stone-50/80 text-stone-700 font-medium" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="[&>tr:nth-child(even)]:bg-stone-50/40" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="border-b border-stone-200/60 last:border-b-0" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, node: _node, ...props }) => {
    const { variant } = useContext(TableContext);
    const presentation = TABLE_PRESENTATION[variant];

    return (
      <th className={presentation.thClassName} {...props}>
        <div
          className={cn(
            presentation.cellContentClassName,
            variant === "compact" ? "mx-auto text-center" : "mx-0 text-left"
          )}
        >
          {children}
        </div>
      </th>
    );
  },
  td: ({ children, node, ...props }) => {
    const { variant } = useContext(TableContext);
    const presentation = TABLE_PRESENTATION[variant];
    const shouldCenter = shouldCenterTableCell(variant, getAstText(node));

    return (
      <td className={presentation.tdClassName} {...props}>
        <div
          className={cn(
            presentation.cellContentClassName,
            shouldCenter
              ? variant === "compact"
                ? "mx-auto text-center"
                : "mx-auto w-max whitespace-nowrap text-center"
              : "mx-0 text-left"
          )}
        >
          {children}
        </div>
      </td>
    );
  },
  input: ({ type, checked, ...props }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={checked}
        disabled
        readOnly
        className="mr-2 h-3.5 w-3.5 translate-y-[1px] accent-orange-500"
        {...props}
      />
    ) : (
      <input type={type} checked={checked} {...props} />
    ),
  pre: ({ children }) => children,
  code: ({ inline, className, children, node: _node, ...props }: MarkdownCodeProps) => {
    const { inTable } = useContext(TableContext);
    const match = /language-([\w-]+)/.exec(className || "");
    const language = match?.[1];
    const code = String(children).replace(/\n$/, "");

    const isSingleLine = !code.includes('\n');
    const isTextLang = !language || language === "text";

    if (inline || (isTextLang && isSingleLine)) {
      return (
        <code
          className={cn(
            "rounded-[3px] bg-[#f2f2f3] font-mono text-[0.85em] text-[#5a5450]",
            inline ? "px-[0.25em] py-[0.06em]" : "px-[0.35em] py-[0.1em] inline-block"
          )}
          {...props}
        >
          {children}
        </code>
      );
    }

    const lang = language || "text";

    if (lang === "mermaid") {
      return <MermaidBlock code={code} />;
    }

    return <HighlightedCodeBlock code={code} inTable={inTable} language={lang} />;
  }
};

const MarkdownBlock = memo(
  function MarkdownBlock({ block }: { block: string }) {
    return (
      <div>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkToc, { heading: "toc|table[ -]of[ -]contents|目录", tight: true }]]}
          rehypePlugins={[rehypeSlug]}
          components={markdownComponents}
        >
          {block}
        </ReactMarkdown>
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.block === nextProps.block
);

function splitMarkdownIntoBlocks(content: string) {
  if (!content.trim()) {
    return [];
  }

  try {
    const tokens = marked.lexer(content, { gfm: true });
    const blocks = tokens
      .filter((token) => token.type !== "space" && token.raw.trim().length > 0)
      .map((token) => token.raw);

    return blocks.length > 0 ? blocks : [content];
  } catch {
    return [content];
  }
}

const FullMarkdown = memo(function FullMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => splitMarkdownIntoBlocks(content), [content]);

  return (
    <div className="ai-message-content min-w-0 space-y-4">
      {blocks.map((block, index) => (
        <MarkdownBlock key={`${index}-${block.slice(0, 20)}`} block={block} />
      ))}
    </div>
  );
});

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return <FullMarkdown content={content} />;
}
