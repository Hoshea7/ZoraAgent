import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { McpServerEntry } from "../../../shared/types/mcp";
import {
  deleteMcpServerAtom,
  loadMcpConfigAtom,
  mcpConfigAtom,
  mcpEditModeAtom,
  toggleMcpServerAtom,
} from "../../store/mcp";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";
import { McpJsonEditor } from "./McpJsonEditor";

const typeBadgeClassNames: Record<McpServerEntry["type"], string> = {
  stdio: "bg-stone-100 text-stone-600",
  http: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
  sse: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
};

function formatSummary(server: McpServerEntry): string {
  if (server.type === "stdio") {
    if (!server.command) {
      return "未配置启动命令";
    }

    const args = server.args?.filter(Boolean).join(" ");
    return args ? `${server.command} ${args}` : server.command;
  }

  return server.url ?? "未配置服务器地址";
}

function formatTestTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  } catch {
    return "";
  }
}

function renderLastTestResult(server: McpServerEntry) {
  if (!server.lastTestResult) {
    return (
      <span className="inline-flex items-center gap-2 text-[12px] text-stone-400">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300" />
        尚未测试
      </span>
    );
  }

  const { success, message, timestamp } = server.lastTestResult;
  const timestampLabel = formatTestTime(timestamp);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[12px]",
        success ? "text-emerald-600" : "text-rose-600"
      )}
      title={message}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          success ? "bg-emerald-500" : "bg-rose-500"
        )}
      />
      {success ? "最近测试成功" : "最近测试失败"}
      {timestampLabel ? ` · ${timestampLabel}` : ""}
    </span>
  );
}

export function McpSettings() {
  const config = useAtomValue(mcpConfigAtom);
  const [editMode, setEditMode] = useAtom(mcpEditModeAtom);
  const loadMcpConfig = useSetAtom(loadMcpConfigAtom);
  const deleteMcpServer = useSetAtom(deleteMcpServerAtom);
  const toggleMcpServer = useSetAtom(toggleMcpServerAtom);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeServerName, setActiveServerName] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        await loadMcpConfig();
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
  }, [loadMcpConfig]);

  const servers = Object.entries(config.servers);

  const handleDeleteServer = async (name: string) => {
    setActiveServerName(name);
    setErrorMessage(null);

    try {
      await deleteMcpServer(name);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setActiveServerName(null);
    }
  };

  const handleToggleServer = async (name: string, entry: McpServerEntry) => {
    if (!entry.enabled && !entry.lastTestResult?.success) {
      setErrorMessage("请在 JSON 模式中重新保存并测试");
      return;
    }

    setActiveServerName(name);
    setErrorMessage(null);

    try {
      await toggleMcpServer({ name, enabled: !entry.enabled });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setActiveServerName(null);
    }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 w-full space-y-8 pb-12 duration-500">
      <div className="flex flex-col gap-5 border-b border-stone-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-[28px] font-bold tracking-tight text-stone-900">MCP</h2>
          <p className="max-w-[520px] text-[14px] leading-relaxed text-stone-400">
            列表页只负责查看和管理已配置的 Server。新增或修改配置，请直接切换到 JSON 视图。
          </p>
        </div>

        <div className="inline-flex rounded-full bg-stone-100 p-1 shadow-inner">
          <button
            type="button"
            onClick={() => setEditMode("list")}
            className={cn(
              "rounded-full px-4 py-2 text-[12px] font-medium transition",
              editMode === "list"
                ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
                : "text-stone-500 hover:text-stone-800"
            )}
          >
            列表
          </button>
          <button
            type="button"
            onClick={() => setEditMode("json")}
            className={cn(
              "rounded-full px-4 py-2 text-[12px] font-medium transition",
              editMode === "json"
                ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
                : "text-stone-500 hover:text-stone-800"
            )}
          >
            JSON
          </button>
        </div>
      </div>

      {editMode === "json" ? <McpJsonEditor /> : null}

      {editMode === "list" && errorMessage ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-[13px] text-rose-600">
          {errorMessage}
        </div>
      ) : null}

      {editMode === "list" && isLoading ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-6 py-10 text-center text-[14px] text-stone-500">
          正在加载 MCP 配置…
        </div>
      ) : null}

      {editMode === "list" && !isLoading && servers.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-8 py-14 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-stone-500 shadow-sm ring-1 ring-stone-200">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.7}
                d="M7 7h4v4H7V7zm6 6h4v4h-4v-4zM7 17h4v-2.5m2-7.5h1a3 3 0 013 3v1"
              />
            </svg>
          </div>
          <p className="mt-5 text-[16px] font-semibold text-stone-900">
            尚未配置任何 MCP Server
          </p>
          <p className="mx-auto mt-2 max-w-[480px] text-[13px] leading-relaxed text-stone-500">
            切换到 JSON 视图添加配置。大多数 MCP Server 的 README 都会直接给出一段可复制的 JSON。
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-6 px-5 py-2 text-[13px]"
            onClick={() => setEditMode("json")}
          >
            去 JSON 视图
          </Button>
        </div>
      ) : null}

      {editMode === "list" && !isLoading && servers.length > 0 ? (
        <div className="space-y-3">
          {servers.map(([name, server]) => {
            const isBusy = activeServerName === name;
            const statusLabel = !server.enabled
              ? "已停用"
              : server.lastTestResult?.success
                ? "✅ 已就绪"
                : "⚠ 未验证";

            return (
              <article
                key={name}
                className="rounded-[20px] border border-stone-200 bg-white px-5 py-4 shadow-[0_10px_30px_rgba(28,25,23,0.06)]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-stone-900">{name}</h3>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                          typeBadgeClassNames[server.type]
                        )}
                      >
                        {server.type}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                          !server.enabled
                            ? "bg-stone-100 text-stone-500"
                            : server.lastTestResult?.success
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-100"
                        )}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    <p
                      className="truncate text-[13px] text-stone-500"
                      title={formatSummary(server)}
                    >
                      {formatSummary(server)}
                    </p>

                    <div>{renderLastTestResult(server)}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!server.isBuiltin ? (
                      <Button
                        type="button"
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => void handleDeleteServer(name)}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-[12px]"
                      >
                        删除
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleToggleServer(name, server)}
                      disabled={isBusy}
                      className="px-3 py-1.5 text-[12px]"
                    >
                      {server.enabled ? "禁用" : "启用"}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
