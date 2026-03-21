/** MCP 传输类型 */
export type McpTransportType = "stdio" | "http" | "sse";

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
