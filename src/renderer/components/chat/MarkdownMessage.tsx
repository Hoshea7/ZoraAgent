import { memo, useMemo, useState, useEffect, useRef, createContext, useContext, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
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

type SyntaxHighlighterAssets = {
  SyntaxHighlighter: typeof import("react-syntax-highlighter")["Prism"];
  syntaxTheme: Record<string, CSSProperties>;
};

const TableContext = createContext(false);
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

let syntaxHighlighterAssetsPromise: Promise<SyntaxHighlighterAssets> | null = null;
let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;

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
      className={cn(
        "relative group overflow-hidden rounded-xl border border-stone-200/80 bg-stone-50 shadow-sm",
        inTable ? "my-1.5" : "my-5"
      )}
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

function MermaidBlock({ code }: { code: string }) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [hasError, setHasError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const inTable = useContext(TableContext);
  const idRef = useRef(`mermaid-svg-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    let isMounted = true;
    setHasError(false);

    const renderMermaid = async () => {
      try {
        const cleanCode = code.trim();
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(idRef.current, cleanCode);
        const sanitizedSvg = sanitizeMermaidSvg(svg);

        if (!sanitizedSvg || svg.includes("Syntax error")) {
          throw new Error("Mermaid rendering rejected");
        }

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

  return (
    <>
      {isFullscreen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/90 backdrop-blur-md p-8" onClick={() => setIsFullscreen(false)}>
          <button 
            className="absolute top-6 right-6 p-2 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors shadow-sm"
            onClick={(e) => { e.stopPropagation(); setIsFullscreen(false); }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div 
            className="w-full h-full flex items-center justify-center overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div dangerouslySetInnerHTML={{ __html: svgContent }} className="[&>svg]:max-w-none [&>svg]:w-auto [&>svg]:h-auto bg-white p-8 rounded-2xl shadow-xl border border-stone-100" />
          </div>
        </div>
      )}

      <div
        className={cn("relative group overflow-x-auto bg-white border border-stone-200/80 rounded-xl p-4 shadow-sm hover:border-stone-300 transition-colors cursor-pointer", inTable ? "my-1.5" : "my-5")}
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
      className="mb-4 mt-8 text-[24px] font-semibold tracking-[-0.03em] text-stone-900 first:mt-0"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="mb-3 mt-7 text-[20px] font-semibold tracking-[-0.02em] text-stone-900 first:mt-0"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="mb-3 mt-6 text-[17px] font-semibold text-stone-900 first:mt-0"
      {...props}
    >
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-4 leading-[1.78] text-stone-700 last:mb-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, className, ...props }) => (
    <ul
      className={cn(
        "mb-4 ml-5 list-disc space-y-2 marker:text-orange-300",
        className?.includes("contains-task-list") ? "ml-0 list-none space-y-2.5" : ""
      )}
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, className, ...props }) => (
    <ol
      className={cn(
        "mb-4 ml-5 list-decimal space-y-2 marker:font-medium marker:text-orange-400",
        className?.includes("contains-task-list") ? "ml-0 list-none space-y-2.5" : ""
      )}
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }) => (
    <li
      className={cn(
        "pl-1 leading-[1.72] text-stone-700 [&>p]:mb-0",
        className?.includes("task-list-item") ? "list-none pl-0" : ""
      )}
      {...props}
    >
      {children}
    </li>
  ),
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-orange-700 underline decoration-orange-200 underline-offset-[0.22em] transition-colors hover:text-orange-800 hover:decoration-orange-400"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-5 rounded-r-[18px] border-l-[3px] border-orange-300/80 bg-[#fbf5ee] px-4 py-3 text-stone-600"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className="my-6 border-0 border-t border-stone-200/80" {...props} />,
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-stone-900" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="text-stone-700/95" {...props}>
      {children}
    </em>
  ),
  table: ({ children, ...props }) => (
    <TableContext.Provider value={true}>
      <div className="my-5 overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-left text-[14px]" {...props}>
          {children}
        </table>
      </div>
    </TableContext.Provider>
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
  th: ({ children, ...props }) => (
    <th className="px-4 py-3 font-semibold text-stone-700 border-b border-stone-200" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-4 py-3 align-top text-stone-600" {...props}>
      {children}
    </td>
  ),
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
    const inTable = useContext(TableContext);
    const match = /language-([\w-]+)/.exec(className || "");
    const language = match?.[1];
    const code = String(children).replace(/\n$/, "");

    const isSingleLine = !code.includes('\n');
    const isTextLang = !language || language === "text";

    if (inline || (isTextLang && isSingleLine)) {
      return (
        <code
          className={cn(
            "rounded-md border border-stone-200 bg-stone-100 font-mono text-[13px] text-stone-700 break-words",
            inline ? "px-1.5 py-0.5" : "px-2 py-[2px] inline-block my-0.5"
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
      <div style={{ contentVisibility: "auto" }}>
        <ReactMarkdown 
          remarkPlugins={[remarkGfm, [remarkToc, { heading: 'toc|table[ -]of[ -]contents|目录', tight: true }]]} 
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

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const blocks = useMemo(() => splitMarkdownIntoBlocks(content), [content]);

  return (
    <div className="min-w-0 text-[15px] text-stone-800">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} block={block} />
      ))}
    </div>
  );
}
