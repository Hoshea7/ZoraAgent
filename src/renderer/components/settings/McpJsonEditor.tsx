import { useEffect, useMemo, useState } from "react";
import { useSetAtom } from "jotai";
import type { McpConfig, McpRawJsonSaveResult } from "../../../shared/types/mcp";
import { loadMcpConfigAtom } from "../../store/mcp";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";

const textareaClassName = [
  "min-h-[420px] w-full resize-y rounded-[20px] border border-stone-200 bg-white px-5 py-4",
  "font-mono text-[13px] leading-6 text-stone-800 outline-none transition",
  "placeholder:text-stone-400 focus:border-stone-300 focus:ring-4 focus:ring-stone-200/60",
].join(" ");

const EMPTY_CONFIG = "{\n  \"servers\": {}\n}\n";
const SAMPLE_CONFIG = `{
  "servers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "enabled": true
    }
  }
}`;

function isEmptyConfigJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as McpConfig;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.servers === "object" &&
      parsed.servers !== null &&
      Object.keys(parsed.servers).length === 0
    );
  } catch {
    return false;
  }
}

export function McpJsonEditor() {
  const loadMcpConfig = useSetAtom(loadMcpConfigAtom);
  const [jsonText, setJsonText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<McpRawJsonSaveResult | null>(null);

  useEffect(() => {
    let isActive = true;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const rawJson = await window.zora.mcp.getRawJson();
        if (!isActive) {
          return;
        }

        setJsonText(rawJson);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setErrorMessage(getErrorMessage(error));
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isActive = false;
    };
  }, []);

  const showGuide = useMemo(
    () => !isLoading && !isFocused && isEmptyConfigJson(jsonText || EMPTY_CONFIG),
    [isFocused, isLoading, jsonText]
  );

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    setSaveResult(null);

    try {
      const result = await window.zora.mcp.saveRawJson(jsonText);
      setSaveResult(result);

      if (!result.success) {
        return;
      }

      await loadMcpConfig();
      const latestRawJson = await window.zora.mcp.getRawJson();
      setJsonText(latestRawJson);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-[24px] border border-stone-200 bg-stone-50/60 p-5">
        <div className="flex flex-col gap-3 border-b border-stone-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-[16px] font-semibold text-stone-900">mcp.json</h3>
            <p className="max-w-[720px] text-[13px] leading-relaxed text-stone-500">
              这里是 MCP 配置的唯一入口。把 GitHub README 里的 JSON 片段粘贴进来，保存时会自动测试新增或修改过的 Server。
            </p>
          </div>

          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={isLoading || isSaving}
            className="min-w-[132px] self-start px-5 py-2.5 text-[13px]"
          >
            {isSaving ? "测试并保存中…" : "保存并测试"}
          </Button>
        </div>

        {showGuide ? (
          <div className="mt-4 rounded-[20px] border border-stone-200 bg-white/90 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-stone-700">
                  从 MCP Server 的 GitHub 页面复制配置 JSON，粘贴到下方编辑器中。
                </p>
                <p className="text-[12px] leading-relaxed text-stone-500">
                  社区大多数 MCP Server 都会直接给出一段可复制的配置。把其中的目录、URL 或 token 替换成你自己的真实值即可。
                </p>
              </div>

              <a
                href="https://github.com/modelcontextprotocol/servers"
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-[12px] font-medium text-stone-600 transition hover:border-stone-300 hover:bg-stone-100 hover:text-stone-900"
              >
                浏览社区 MCP Servers
                <span aria-hidden="true">→</span>
              </a>
            </div>

            <div className="mt-4 overflow-hidden rounded-[18px] border border-stone-200 bg-stone-50">
              <div className="border-b border-stone-200 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400">
                示例 JSON
              </div>
              <pre className="m-0 overflow-x-auto px-4 py-4 font-mono text-[12px] leading-6 text-stone-600">
                {SAMPLE_CONFIG}
              </pre>
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          {isLoading ? (
            <div className="rounded-[20px] border border-stone-200 bg-white px-6 py-12 text-center text-[14px] text-stone-500">
              正在读取 MCP 配置…
            </div>
          ) : (
            <textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className={cn(textareaClassName, showGuide && "min-h-[340px]")}
              spellCheck={false}
              aria-label="MCP JSON editor"
              placeholder={EMPTY_CONFIG}
            />
          )}
        </div>
      </div>

      {saveResult ? (
        <div
          className={cn(
            "rounded-[20px] border px-4 py-4",
            saveResult.success
              ? "border-emerald-100 bg-emerald-50/80"
              : "border-rose-100 bg-rose-50/80"
          )}
        >
          <p
            className={cn(
              "text-[13px] font-medium",
              saveResult.success ? "text-emerald-700" : "text-rose-700"
            )}
          >
            {saveResult.success
              ? "配置已保存，MCP Server 测试全部通过。"
              : saveResult.error ?? "保存失败，请检查配置后重试。"}
          </p>

          {saveResult.results.length > 0 ? (
            <div className="mt-3 space-y-2">
              {saveResult.results.map((result) => (
                <div
                  key={result.name}
                  className={cn(
                    "rounded-[16px] border px-3 py-2.5 text-[12px]",
                    result.success
                      ? "border-emerald-100 bg-white/90 text-emerald-700"
                      : "border-rose-100 bg-white/90 text-rose-700"
                  )}
                >
                  <span className="font-semibold">{result.name}</span>
                  {" · "}
                  {result.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-[20px] border border-rose-100 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
          {errorMessage}
        </div>
      ) : null}
    </section>
  );
}
