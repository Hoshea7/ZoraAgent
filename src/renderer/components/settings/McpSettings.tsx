import { type ReactNode, useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  getMcpBuiltinDefinition,
  type McpServerEntry,
} from "../../../shared/types/mcp";
import {
  deleteMcpServerAtom,
  loadMcpConfigAtom,
  mcpConfigAtom,
  toggleMcpServerAtom,
} from "../../store/mcp";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";
import { McpManualAddDialog } from "./McpManualAddDialog";

const typeBadgeClassNames: Record<McpServerEntry["type"], string> = {
  stdio: "bg-stone-100 text-stone-600",
  http: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
  sse: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  sdk: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
};

type ServerStatusTone = "neutral" | "green" | "yellow" | "red";

interface ServerStatus {
  label: string;
  color: ServerStatusTone;
  icon: string;
}

function formatServerDisplayName(name: string, server: McpServerEntry): string {
  return getMcpBuiltinDefinition(server.builtinKey)?.displayName ?? name;
}

function formatSummary(server: McpServerEntry): string {
  if (server.type === "sdk") {
    const builtin = getMcpBuiltinDefinition(server.builtinKey);
    if (builtin) {
      return server.env?.[builtin.envKey]
        ? builtin.configuredSummary
        : builtin.missingSummary;
    }

    return "内置工具";
  }

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

function getServerStatus(server: McpServerEntry): ServerStatus {
  if (!server.enabled) {
    return { label: "已禁用", color: "neutral", icon: "⏸" };
  }

  if (!server.lastTestResult) {
    return { label: "未测试", color: "yellow", icon: "⚠️" };
  }

  if (server.lastTestResult.success) {
    return { label: "已就绪", color: "green", icon: "✅" };
  }

  return { label: "连接失败", color: "red", icon: "❌" };
}

function getStatusDotClassName(status: ServerStatus, enabled: boolean): string {
  if (!enabled) {
    return "border border-stone-300 bg-transparent";
  }

  if (status.color === "green") {
    return "bg-emerald-500";
  }

  if (status.color === "yellow") {
    return "bg-amber-400";
  }

  if (status.color === "red") {
    return "bg-rose-500";
  }

  return "bg-stone-300";
}

function getStatusBadgeClassName(status: ServerStatus): string {
  if (status.color === "green") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
  }

  if (status.color === "yellow") {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
  }

  if (status.color === "red") {
    return "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
  }

  return "bg-stone-100 text-stone-500";
}

function renderLastTestResult(server: McpServerEntry) {
  if (!server.lastTestResult) {
    return <span className="text-stone-400">尚未测试</span>;
  }

  const { success, message, timestamp } = server.lastTestResult;
  const timestampLabel = formatTestTime(timestamp);

  return (
    <span className={cn(success ? "text-emerald-600" : "text-rose-500")} title={message}>
      ● {success ? "最近测试成功" : "最近测试失败"}
      {timestampLabel ? ` · ${timestampLabel}` : ""}
    </span>
  );
}

interface SectionProps {
  title: string;
  count: number;
  children: ReactNode;
}

function Section({ title, count, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-stone-900">{title}</h3>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
            {count}
          </span>
        </div>
      </div>
      {children}
    </section>
  );
}

interface ServerCardProps {
  name: string;
  server: McpServerEntry;
  busy: boolean;
  onConfigure: (name: string, server: McpServerEntry) => void;
  onToggle: (name: string, server: McpServerEntry) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}

function ServerCard({
  name,
  server,
  busy,
  onConfigure,
  onToggle,
  onDelete,
}: ServerCardProps) {
  const status = getServerStatus(server);
  const isDisabled = !server.enabled;

  return (
    <article
      className={cn(
        "rounded-[22px] border px-5 py-4 shadow-[0_10px_30px_rgba(28,25,23,0.06)] transition",
        isDisabled ? "border-stone-200 bg-stone-50/80" : "border-stone-200 bg-white"
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                  getStatusDotClassName(status, server.enabled)
                )}
                aria-hidden="true"
              />
              <h4
                className={cn(
                  "text-[15px] font-semibold",
                  isDisabled ? "text-stone-700" : "text-stone-900"
                )}
              >
                {formatServerDisplayName(name, server)}
              </h4>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  typeBadgeClassNames[server.type]
                )}
              >
                {server.type.toUpperCase()}
              </span>
            </div>

            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                getStatusBadgeClassName(status)
              )}
            >
              <span aria-hidden="true">{status.icon}</span>
              {status.label}
            </span>
          </div>

          <p
            className={cn(
              "truncate font-mono text-[12px]",
              isDisabled ? "text-stone-400" : "text-stone-500"
            )}
            title={formatSummary(server)}
          >
            {formatSummary(server)}
          </p>

          <div className="flex flex-col gap-3 text-[12px] sm:flex-row sm:items-center sm:justify-between">
            <div>{renderLastTestResult(server)}</div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onConfigure(name, server)}
                disabled={busy}
                className="text-stone-500 transition hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                配置
              </button>
              <button
                type="button"
                onClick={() => void onToggle(name, server)}
                disabled={busy}
                className={cn(
                  "transition hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50",
                  isDisabled ? "text-stone-600" : "text-stone-500"
                )}
              >
                {server.enabled ? "禁用" : "启用"}
              </button>
              {!server.isBuiltin ? (
                <button
                  type="button"
                  onClick={() => void onDelete(name)}
                  disabled={busy}
                  className="text-rose-400 transition hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  删除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function McpSettings() {
  const config = useAtomValue(mcpConfigAtom);
  const loadMcpConfig = useSetAtom(loadMcpConfigAtom);
  const deleteMcpServer = useSetAtom(deleteMcpServerAtom);
  const toggleMcpServer = useSetAtom(toggleMcpServerAtom);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeServerName, setActiveServerName] = useState<string | null>(null);
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<{
    name: string;
    entry: McpServerEntry;
  } | null>(null);

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
  const enabledCount = servers.filter(([, server]) => server.enabled).length;
  const disabledCount = servers.length - enabledCount;
  const customServers = servers.filter(([, server]) => !server.isBuiltin);
  const builtinServers = servers.filter(([, server]) => server.isBuiltin);

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

  const handleOpenAddDialog = () => {
    setEditingServer(null);
    setIsManualDialogOpen(true);
  };

  const handleOpenEditDialog = (name: string, entry: McpServerEntry) => {
    setEditingServer({ name, entry });
    setIsManualDialogOpen(true);
  };

  const handleToggleServer = async (name: string, entry: McpServerEntry) => {
    if (!entry.enabled && !entry.lastTestResult?.success) {
      setErrorMessage("请先重新保存并测试");
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
    <>
      <McpManualAddDialog
        open={isManualDialogOpen}
        onClose={() => {
          setIsManualDialogOpen(false);
          setEditingServer(null);
        }}
        editingServer={editingServer}
      />

      <section className="animate-in fade-in slide-in-from-bottom-4 w-full space-y-8 pb-12 duration-500">
        <div className="flex flex-col gap-5 border-b border-stone-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-[28px] font-bold tracking-tight text-stone-900">MCP</h2>
          <p className="text-[14px] leading-relaxed text-stone-500">
              已配置 {servers.length} 个 Server
              {servers.length > 0 ? (
                <>
                  {" · "}
                  <span className="text-emerald-600">{enabledCount} 个启用</span>
                  {" · "}
                  <span className="text-stone-400">{disabledCount} 个禁用</span>
                </>
              ) : null}
            </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleOpenAddDialog}
            className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2.5 text-[13px] font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-200/60"
          >
            <span className="text-[18px] leading-none">+</span>
            添加 MCP Server
          </button>
        </div>
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-[13px] text-rose-600">
            {errorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-6 py-10 text-center text-[14px] text-stone-500">
            正在加载 MCP 配置…
          </div>
        ) : (
          <div className="space-y-8">
            <Section title="我添加的" count={customServers.length}>
              {customServers.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-8 py-12 text-center">
                  <p className="text-[15px] font-semibold text-stone-900">
                    还没有添加 MCP Server
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-5 px-5 py-2.5 text-[13px]"
                    onClick={() => setIsManualDialogOpen(true)}
                  >
                    手动添加
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {customServers.map(([name, server]) => (
                    <ServerCard
                      key={name}
                      name={name}
                      server={server}
                      busy={activeServerName === name}
                      onConfigure={handleOpenEditDialog}
                      onToggle={handleToggleServer}
                      onDelete={handleDeleteServer}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title="内置" count={builtinServers.length}>
              {builtinServers.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-stone-200 bg-stone-50/50 px-8 py-10 text-center text-[13px] text-stone-400">
                  暂无内置 MCP
                </div>
              ) : (
                <div className="space-y-3">
                  {builtinServers.map(([name, server]) => (
                    <ServerCard
                      key={name}
                      name={name}
                      server={server}
                      busy={activeServerName === name}
                      onConfigure={handleOpenEditDialog}
                      onToggle={handleToggleServer}
                      onDelete={handleDeleteServer}
                    />
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </section>
    </>
  );
}
