import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSetAtom } from "jotai";
import type {
  McpSaveResult,
  McpRawJsonSaveResult,
  McpServerEntry,
} from "../../../shared/types/mcp";
import { getMcpBuiltinDefinition } from "../../../shared/types/mcp";
import { loadMcpConfigAtom } from "../../store/mcp";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";

const SAMPLE_CONFIG = `{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "enabled": true
    }
  }
}`;

const MASKED_API_KEY_DISPLAY = "••••••••••••••••••••";

interface McpManualAddDialogProps {
  open: boolean;
  onClose: () => void;
  editingServer?: { name: string; entry: McpServerEntry } | null;
}

interface ConnectionTestState {
  status: "success" | "error";
  message: string;
}

function extractJsonSaveResult(saveResult: McpSaveResult): McpRawJsonSaveResult {
  if (saveResult.mode === "entry") {
    throw new Error("当前保存结果不是 JSON 保存模式");
  }

  return saveResult.result;
}

function createEditableEntry(entry: McpServerEntry): Partial<McpServerEntry> {
  return {
    type: entry.type,
    command: entry.command,
    args: entry.args ? [...entry.args] : undefined,
    url: entry.url,
    headers: entry.headers ? { ...entry.headers } : undefined,
    env: entry.env ? { ...entry.env } : undefined,
    timeout: entry.timeout,
    enabled: entry.enabled,
    isBuiltin: entry.isBuiltin,
    builtinKey: entry.builtinKey,
  };
}

function getBuiltinConfig(editingServer?: { name: string; entry: McpServerEntry } | null) {
  const builtinKey = editingServer?.entry.isBuiltin ? editingServer.entry.builtinKey : undefined;
  return getMcpBuiltinDefinition(builtinKey);
}

function createBuiltinEntry(
  builtinKey: NonNullable<McpServerEntry["builtinKey"]>,
  apiKey: string,
  currentEntry: McpServerEntry
): McpServerEntry {
  const config = getMcpBuiltinDefinition(builtinKey);
  if (!config) {
    throw new Error(`未知的内置 MCP: ${builtinKey}`);
  }

  return {
    type: "sdk",
    enabled: currentEntry.enabled,
    isBuiltin: true,
    builtinKey,
    env: apiKey.trim() ? { [config.envKey]: apiKey.trim() } : undefined,
    timeout: currentEntry.timeout ?? 30,
    lastTestResult: currentEntry.lastTestResult ? { ...currentEntry.lastTestResult } : undefined,
  };
}

function VisibilityIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
        />
      </svg>
    );
  }

  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.543 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

export function McpManualAddDialog({
  open,
  onClose,
  editingServer = null,
}: McpManualAddDialogProps) {
  const loadMcpConfig = useSetAtom(loadMcpConfigAtom);
  const [snippetText, setSnippetText] = useState("");
  const [fallbackName, setFallbackName] = useState("");
  const [showCurrentJson, setShowCurrentJson] = useState(false);
  const [editableConfigJson, setEditableConfigJson] = useState("");
  const [isLoadingEditableConfig, setIsLoadingEditableConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<McpRawJsonSaveResult | null>(null);
  const [builtinApiKey, setBuiltinApiKey] = useState("");
  const [showBuiltinApiKey, setShowBuiltinApiKey] = useState(false);
  const [connectionTestState, setConnectionTestState] = useState<ConnectionTestState | null>(null);

  const builtinConfig = getBuiltinConfig(editingServer);
  const isBuiltinTool = Boolean(builtinConfig && editingServer?.entry.builtinKey);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSnippetText("");
    setEditableConfigJson("");
    setIsLoadingEditableConfig(false);
    setShowCurrentJson(false);
    setSaveResult(null);
    setIsSaving(false);
    setErrorMessage(null);
    setFallbackName(editingServer?.name ?? "");
    setBuiltinApiKey("");
    setShowBuiltinApiKey(false);
    setConnectionTestState(null);
  }, [editingServer, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let isActive = true;

    const loadEditableConfig = async () => {
      if (
        typeof window.zora.mcp.getConfig !== "function" ||
        typeof window.zora.mcp.getEditableConfig !== "function"
      ) {
        if (editingServer && isBuiltinTool) {
          setErrorMessage("当前应用仍在使用旧的 preload，请重启后再试");
        }
        return;
      }

      setIsLoadingEditableConfig(true);

      try {
        if (!editingServer) {
          const currentConfig = await window.zora.mcp.getConfig();
          if (!isActive) {
            return;
          }

          setEditableConfigJson(`${JSON.stringify(currentConfig, null, 2)}\n`);
          return;
        }

        const editableConfig = await window.zora.mcp.getEditableConfig();
        if (!isActive) {
          return;
        }

        const currentEntry = editableConfig.servers[editingServer.name];
        if (!currentEntry) {
          setErrorMessage("未能读取当前 MCP 配置");
          return;
        }

        if (builtinConfig && editingServer.entry.builtinKey) {
          setBuiltinApiKey(currentEntry.env?.[builtinConfig.envKey] ?? "");
          return;
        }

        const currentEntryJson = `${JSON.stringify(createEditableEntry(currentEntry), null, 2)}\n`;
        setEditableConfigJson(currentEntryJson);
        setSnippetText(currentEntryJson);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setErrorMessage(getErrorMessage(error));

        if (editingServer) {
          if (builtinConfig && editingServer.entry.builtinKey) {
            setBuiltinApiKey(editingServer.entry.env?.[builtinConfig.envKey] ?? "");
          } else {
            setSnippetText(`${JSON.stringify(createEditableEntry(editingServer.entry), null, 2)}\n`);
          }
        }
      } finally {
        if (isActive) {
          setIsLoadingEditableConfig(false);
        }
      }
    };

    void loadEditableConfig();

    return () => {
      isActive = false;
    };
  }, [builtinConfig, editingServer, isBuiltinTool, open]);

  const handleSaveCustomServer = async () => {
    if (!snippetText.trim()) {
      setErrorMessage("请粘贴 MCP 配置");
      setSaveResult(null);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSaveResult(null);
    setConnectionTestState(null);

    try {
      const response = editingServer
        ? await window.zora.mcp.save({
            mode: "single-json",
            name: editingServer.name,
            json: snippetText,
          })
        : await window.zora.mcp.save({
            mode: "merge-json",
            json: snippetText,
            fallbackName: fallbackName.trim() || undefined,
          });
      const result = extractJsonSaveResult(response);

      if (!result.success) {
        setSaveResult(result);
        return;
      }

      await loadMcpConfig();
      onClose();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBuiltinTool = async () => {
    if (!editingServer || !builtinConfig || !editingServer.entry.builtinKey) {
      return;
    }

    const apiKey = builtinApiKey.trim();
    if (!apiKey) {
      setErrorMessage(`请填写 ${builtinConfig.label}`);
      setConnectionTestState(null);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSaveResult(null);
    setConnectionTestState(null);

    try {
      const nextEntry = createBuiltinEntry(editingServer.entry.builtinKey, apiKey, editingServer.entry);
      const testResult = await window.zora.mcp.testServer(editingServer.name, nextEntry);

      setConnectionTestState({
        status: testResult.success ? "success" : "error",
        message: testResult.message,
      });

      if (!testResult.success) {
        return;
      }

      await window.zora.mcp.save({
        mode: "entry",
        name: editingServer.name,
        entry: {
          ...nextEntry,
          lastTestResult: {
            success: testResult.success,
            message: testResult.message,
            timestamp: Date.now(),
          },
        },
      });

      await loadMcpConfig();
      onClose();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[160] bg-stone-900/25 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={isBuiltinTool ? `配置 ${builtinConfig?.title ?? "内置工具"}` : "手动添加 MCP"}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          className="w-full max-w-[860px] overflow-hidden rounded-[28px] border border-stone-200/80 bg-[#fcfaf7] shadow-[0_32px_100px_rgba(41,37,36,0.22)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-stone-200/80 px-6 py-5">
            <div className="space-y-1">
              <h3 className="text-[28px] font-semibold tracking-[-0.03em] text-stone-900">
                {isBuiltinTool ? `配置 ${builtinConfig?.title ?? "内置工具"}` : editingServer ? "配置 MCP" : "手动添加"}
              </h3>
              <p className="text-[12px] text-stone-400">MCP Server</p>
            </div>

            <div className="flex items-center gap-2">
              {!editingServer && !isBuiltinTool ? (
                <button
                  type="button"
                  onClick={() => setSnippetText(SAMPLE_CONFIG)}
                  className="rounded-full border border-stone-200 bg-white px-3.5 py-2 text-[12px] font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                >
                  示例
                </button>
              ) : null}
              {!editingServer && !isBuiltinTool ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowCurrentJson((visible) => !visible)}
                    className="rounded-full border border-stone-200 bg-white px-3.5 py-2 text-[12px] font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                  >
                    {showCurrentJson ? "隐藏 JSON" : "当前 JSON"}
                  </button>
                  <a
                    href="https://github.com/modelcontextprotocol/servers"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-stone-200 bg-white px-3.5 py-2 text-[12px] font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                  >
                    社区
                  </a>
                </>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full text-stone-400 transition hover:bg-white hover:text-stone-700"
                aria-label="关闭"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

            <div className="space-y-4 px-6 py-5">
            {showCurrentJson && !editingServer && !isBuiltinTool ? (
              <div className="overflow-hidden rounded-[20px] border border-stone-200 bg-white">
                <div className="border-b border-stone-200 px-4 py-3 text-[12px] font-medium text-stone-500">
                  当前配置
                </div>
                {isLoadingEditableConfig ? (
                  <div className="px-4 py-6 text-[12px] text-stone-500">正在读取配置…</div>
                ) : (
                  <pre className="m-0 max-h-[220px] overflow-auto px-4 py-4 font-mono text-[12px] leading-6 text-stone-600">
                    {editableConfigJson}
                  </pre>
                )}
              </div>
            ) : null}

            {isBuiltinTool && builtinConfig ? (
              <div className="rounded-[22px] border border-stone-200 bg-white p-5">
                <div className="space-y-1">
                  <h4 className="text-[15px] font-semibold text-stone-900">{builtinConfig.label}</h4>
                  <p className="text-[12px] text-stone-400">{builtinConfig.helper}</p>
                </div>

                <div className="mt-4 flex items-center rounded-[18px] border border-stone-200 px-4 py-3">
                  <input
                    type={showBuiltinApiKey ? "text" : "password"}
                    value={
                      !showBuiltinApiKey && builtinApiKey
                        ? MASKED_API_KEY_DISPLAY
                        : builtinApiKey
                    }
                    onChange={(event) => {
                      setBuiltinApiKey(event.target.value);
                      setConnectionTestState(null);
                    }}
                    readOnly={!showBuiltinApiKey && Boolean(builtinApiKey)}
                    placeholder={builtinConfig.placeholder}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[14px] tracking-[0.08em] text-stone-900 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-stone-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBuiltinApiKey((visible) => !visible)}
                    className="ml-3 flex h-6 w-6 items-center justify-center text-stone-400 transition hover:text-stone-700"
                    aria-label={showBuiltinApiKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    <VisibilityIcon visible={showBuiltinApiKey} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <label
                    htmlFor="mcp-fallback-name"
                    className="text-[12px] font-medium text-stone-500"
                  >
                    Server 名称
                  </label>
                  <input
                    id="mcp-fallback-name"
                    value={fallbackName}
                    onChange={(event) => setFallbackName(event.target.value)}
                    placeholder="bare entry 时填写"
                    disabled={Boolean(editingServer)}
                    className="w-full rounded-[16px] border border-stone-200 bg-white px-3.5 py-2.5 text-[13px] text-stone-800 outline-none transition placeholder:text-stone-400 focus:border-stone-300 focus:ring-4 focus:ring-stone-200/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="mcp-json-snippet"
                    className="text-[12px] font-medium text-stone-500"
                  >
                    JSON
                  </label>
                  <textarea
                    id="mcp-json-snippet"
                    value={snippetText}
                    onChange={(event) => setSnippetText(event.target.value)}
                    disabled={isLoadingEditableConfig}
                    className="min-h-[360px] w-full resize-y rounded-[20px] border border-stone-200 bg-white px-5 py-4 font-mono text-[13px] leading-6 text-stone-800 outline-none transition placeholder:text-stone-300 focus:border-stone-300 focus:ring-4 focus:ring-stone-200/60"
                    placeholder={SAMPLE_CONFIG}
                    spellCheck={false}
                  />
                </div>
              </div>
            )}

            {saveResult && !saveResult.success ? (
              <div className="rounded-[20px] border border-rose-100 bg-rose-50/85 px-4 py-4">
                <p className="text-[13px] font-medium text-rose-700">
                  {saveResult.error ?? "保存失败"}
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

            {connectionTestState ? (
              <div
                className={cn(
                  "rounded-[18px] border px-4 py-3 text-[13px]",
                  connectionTestState.status === "success"
                    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                    : "border-rose-100 bg-rose-50 text-rose-700"
                )}
              >
                {connectionTestState.message}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="rounded-[18px] border border-rose-100 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
                {errorMessage}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-stone-200/80 bg-white/70 px-6 py-4">
            <Button type="button" variant="secondary" onClick={onClose} className="px-5 py-2.5 text-[13px]">
              取消
            </Button>
              <Button
              type="button"
              onClick={() =>
                void (isBuiltinTool ? handleSaveBuiltinTool() : handleSaveCustomServer())
              }
              disabled={isSaving}
              className="px-5 py-2.5 text-[13px]"
            >
              {isSaving ? "测试并保存中…" : "保存并测试"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
