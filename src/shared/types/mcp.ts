/** MCP 传输类型 */
export type McpTransportType = "stdio" | "http" | "sse" | "sdk";

export type McpBuiltinKey = "web_search" | "web_fetch";

export const MCP_WEB_SEARCH_SERVER_NAME = "zora_web_search";
export const MCP_WEB_FETCH_SERVER_NAME = "zora_web_fetch";
export const LEGACY_MCP_WEB_SEARCH_SERVER_NAME = "mcp_web_search";
export const LEGACY_MCP_WEB_FETCH_SERVER_NAME = "mcp_web_fetch";

export interface McpBuiltinDefinition {
  serverName: string;
  toolName: string;
  displayName: string;
  title: string;
  envKey: string;
  label: string;
  helper: string;
  placeholder: string;
  configuredSummary: string;
  missingSummary: string;
  isReadOnlyTool: boolean;
  legacyServerNames?: string[];
}

export const MCP_BUILTINS: Record<McpBuiltinKey, McpBuiltinDefinition> = {
  web_search: {
    serverName: MCP_WEB_SEARCH_SERVER_NAME,
    toolName: "web_search",
    displayName: "zora_mcp_websearch",
    title: "Web Search",
    envKey: "TAVILY_API_KEY",
    label: "Tavily API Key",
    helper: "用于启用内置 web_search 工具",
    placeholder: "tvly-...",
    configuredSummary: "Tavily Web Search 已配置",
    missingSummary: "等待配置 Tavily API Key",
    isReadOnlyTool: true,
    legacyServerNames: [LEGACY_MCP_WEB_SEARCH_SERVER_NAME],
  },
  web_fetch: {
    serverName: MCP_WEB_FETCH_SERVER_NAME,
    toolName: "web_fetch",
    displayName: "zora_mcp_webfetch",
    title: "Web Fetch",
    envKey: "JINA_API_KEY",
    label: "Jina API Key",
    helper: "用于启用内置 web_fetch 工具",
    placeholder: "jina_...",
    configuredSummary: "Jina Web Fetch 已配置",
    missingSummary: "等待配置 Jina API Key",
    isReadOnlyTool: true,
    legacyServerNames: [LEGACY_MCP_WEB_FETCH_SERVER_NAME],
  },
};

export function getMcpBuiltinDefinition(
  builtinKey?: McpBuiltinKey
): McpBuiltinDefinition | null {
  return builtinKey ? MCP_BUILTINS[builtinKey] : null;
}

export function isSafeBuiltinMcpToolName(toolName: string): boolean {
  return Object.values(MCP_BUILTINS).some(
    (definition) =>
      definition.isReadOnlyTool &&
      toolName === `mcp__${definition.serverName}__${definition.toolName}`
  );
}

/** MCP Server 配置条目 */
export interface McpServerEntry {
  /** 传输类型 */
  type: McpTransportType;
  /** stdio: 可执行命令 */
  command?: string;
  /** stdio: 命令参数 */
  args?: string[];
  /** http/sse: 服务器 URL */
  url?: string;
  /** http/sse: 请求头 */
  headers?: Record<string, string>;
  /** 环境变量 */
  env?: Record<string, string>;
  /** stdio 启动超时秒数，默认 30 */
  timeout?: number;
  /** 是否启用 */
  enabled: boolean;
  /** 是否为内置 MCP（不可删除，V1 预留字段） */
  isBuiltin?: boolean;
  /** 内置 MCP 标识 */
  builtinKey?: McpBuiltinKey;
  /** 最后一次连接测试结果 */
  lastTestResult?: {
    success: boolean;
    message: string;
    timestamp: number;
  };
}

/** MCP 配置文件结构 */
export interface McpConfig {
  servers: Record<string, McpServerEntry>;
}

/** MCP Server 运行时状态 */
export type McpServerRuntimeStatus =
  | "connected"
  | "failed"
  | "needs-auth"
  | "pending"
  | "disabled";

export interface McpServerRuntimeStatusEntry {
  name: string;
  status: McpServerRuntimeStatus;
  error?: string;
}

/** MCP Server 测试结果 */
export interface McpServerTestResult {
  success: boolean;
  message: string;
}

export interface McpRawJsonServerResult extends McpServerTestResult {
  name: string;
}

export interface McpRawJsonSaveResult {
  success: boolean;
  error?: string;
  results: McpRawJsonServerResult[];
}

export interface McpSaveEntryInput {
  mode: "entry";
  name: string;
  entry: McpServerEntry;
}

export interface McpSaveMergeJsonInput {
  mode: "merge-json";
  json: string;
  fallbackName?: string;
}

export interface McpSaveSingleJsonInput {
  mode: "single-json";
  name: string;
  json: string;
}

export type McpSaveInput =
  | McpSaveEntryInput
  | McpSaveMergeJsonInput
  | McpSaveSingleJsonInput;

export type McpSaveResult =
  | {
      mode: "entry";
      config: McpConfig;
    }
  | {
      mode: "merge-json" | "single-json";
      result: McpRawJsonSaveResult;
    };
