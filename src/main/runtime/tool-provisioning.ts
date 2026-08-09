import { z } from "zod";
import type { AgentRunSource, AgentRuntimeType } from "../../shared/zora";
import { MCP_BUILTINS, type McpConfig } from "../../shared/types/mcp";
import { SCHEDULE_TIME_PATTERN } from "../../shared/types/schedule";
import {
  executeScheduleManage,
  ZORA_SCHEDULE_MANAGE_DESCRIPTION,
  ZORA_SCHEDULE_MANAGE_TOOL_NAME,
  ZORA_SCHEDULE_SERVER_NAME,
} from "../builtin-mcp/schedule";
import {
  executeWebFetch,
  JINA_API_KEY_ENV_NAME,
  WEB_FETCH_TOOL_DESCRIPTION,
} from "../builtin-mcp/web-fetch";
import {
  executeWebSearch,
  TAVILY_API_KEY_ENV_NAME,
  WEB_SEARCH_TOOL_DESCRIPTION,
} from "../builtin-mcp/web-search";

export type ProvisionedToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export interface ProvisionedTool {
  serverName: string;
  toolName: string;
  canonicalName: string;
  label: string;
  description: string;
  inputSchema: z.ZodRawShape;
  readOnly: boolean;
  execute: (
    args: Record<string, unknown>,
    context: ProvisionedToolExecutionContext
  ) => Promise<ProvisionedToolResult>;
}

export interface ProvisionedToolExecutionContext {
  sessionId: string;
  workspaceId: string;
  runtime: AgentRuntimeType;
  invocationId?: string;
  signal: AbortSignal;
}

export interface ToolProvisioningRequest {
  sessionId: string;
  workspaceId: string;
  runtime: AgentRuntimeType;
  source: AgentRunSource;
}

export interface ToolProvisioningPlan {
  tools: ProvisionedTool[];
}

export function toCanonicalMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

const webSearchInputSchema = {
  query: z.string().min(1).describe("The search query to look up on the web."),
  topic: z
    .enum(["general", "news"])
    .optional()
    .describe("Use `news` for current events and `general` for broader search."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Maximum number of results to return. Defaults to 10. Maximum is 30."),
} satisfies z.ZodRawShape;

const webFetchInputSchema = {
  url: z
    .string()
    .min(1)
    .describe("The full URL to fetch and convert into clean Markdown."),
} satisfies z.ZodRawShape;

const scheduleSchema = z.union([
  z.object({
    type: z.literal("once"),
    runAt: z.string().min(1),
  }),
  z.object({
    type: z.literal("hourly"),
  }),
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(SCHEDULE_TIME_PATTERN),
  }),
  z.object({
    type: z.literal("weekdays"),
    time: z.string().regex(SCHEDULE_TIME_PATTERN),
  }),
  z.object({
    type: z.literal("weekly"),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1),
    time: z.string().regex(SCHEDULE_TIME_PATTERN),
  }),
]);

const updateSchema = z.object({
  workspaceId: z.string().optional(),
  title: z.string().optional(),
  executionPrompt: z.string().optional(),
  schedule: scheduleSchema.optional(),
});

const scheduleManageInputSchema = {
  action: z
    .enum(["create", "list", "get", "update", "pause", "resume", "delete"])
    .describe(
      "要执行的定时任务管理操作。create 创建任务，list 查看任务列表，get 查看单个任务详情，update 修改任务，pause 暂停任务，resume 恢复任务，delete 删除任务。"
    ),
  workspaceId: z
    .string()
    .optional()
    .describe(
      "工作区 id。list 时可省略，省略会返回所有工作区的任务；create 时使用动态上下文 current_workspace_id 的值。对已有任务执行 get、update、pause、resume、delete 时，使用 action=list 或 action=get 返回的该任务 workspaceId。"
    ),
  taskId: z
    .string()
    .optional()
    .describe(
      "要管理的定时任务 id。get、update、pause、resume、delete 需要此字段。如果用户没有明确指定任务，先使用 action=list 查找候选任务。"
    ),
  title: z
    .string()
    .optional()
    .describe(
      "定时任务列表中展示的短标题。创建任务时必填，建议不超过 40 个中文字符，例如“每日待办整理”。"
    ),
  executionPrompt: z
    .string()
    .optional()
    .describe(
      "定时任务描述，也是未来定时任务运行时发送给新会话的任务指令。创建任务时必填。它要忠于用户意图。简单任务写清目标和输出即可；复杂任务补充背景、输入来源、执行要求、输出要求和边界。不要编造上下文。"
    ),
  schedule: scheduleSchema.optional().describe(
    "定时规则。create 时必填，update 时可选。支持 once、hourly、daily、weekdays、weekly。once 使用 {\"type\":\"once\",\"runAt\":\"未来 ISO 时间\"}；hourly 使用 {\"type\":\"hourly\"}；daily 使用 {\"type\":\"daily\",\"time\":\"HH:mm\"}；weekdays 使用 {\"type\":\"weekdays\",\"time\":\"HH:mm\"}；weekly 使用 {\"type\":\"weekly\",\"weekdays\":[1,2,3],\"time\":\"HH:mm\"}，weekdays 按 1=周一 到 7=周日。"
  ),
  updates: updateSchema.optional().describe(
    "update 操作的修改内容。只传需要修改的字段。可以传 workspaceId 把任务移动到另一个工作区。不要通过 update 创建新任务。"
  ),
} satisfies z.ZodRawShape;

function envApiKey(config: McpConfig, serverName: string, key: string): string {
  return config.servers[serverName]?.env?.[key]?.trim() ?? "";
}

function createProvisionedTool(
  tool: Omit<ProvisionedTool, "canonicalName">
): ProvisionedTool {
  return {
    ...tool,
    canonicalName: toCanonicalMcpToolName(tool.serverName, tool.toolName),
  };
}

export function createToolProvisioningPlan(
  config: McpConfig,
  additionalTools: ProvisionedTool[] = []
): ToolProvisioningPlan {
  const tools: ProvisionedTool[] = [...additionalTools];
  const webSearch = MCP_BUILTINS.web_search;
  const webSearchEntry = config.servers[webSearch.serverName];

  if (webSearchEntry?.enabled) {
    const apiKey = envApiKey(config, webSearch.serverName, TAVILY_API_KEY_ENV_NAME);
    tools.push(
      createProvisionedTool({
        serverName: webSearch.serverName,
        toolName: webSearch.toolName,
        label: webSearch.title,
        description: WEB_SEARCH_TOOL_DESCRIPTION,
        inputSchema: webSearchInputSchema,
        readOnly: true,
        execute: async (args) =>
          executeWebSearch(apiKey, {
            query: String(args.query ?? ""),
            topic: args.topic as "general" | "news" | undefined,
            max_results: args.max_results as number | undefined,
          }),
      })
    );
  }

  const webFetch = MCP_BUILTINS.web_fetch;
  const webFetchEntry = config.servers[webFetch.serverName];

  if (webFetchEntry?.enabled) {
    const apiKey = envApiKey(config, webFetch.serverName, JINA_API_KEY_ENV_NAME);
    tools.push(
      createProvisionedTool({
        serverName: webFetch.serverName,
        toolName: webFetch.toolName,
        label: webFetch.title,
        description: WEB_FETCH_TOOL_DESCRIPTION,
        inputSchema: webFetchInputSchema,
        readOnly: true,
        execute: async (args) =>
          executeWebFetch(apiKey, {
            url: String(args.url ?? ""),
          }),
      })
    );
  }

  tools.push(
    createProvisionedTool({
      serverName: ZORA_SCHEDULE_SERVER_NAME,
      toolName: ZORA_SCHEDULE_MANAGE_TOOL_NAME,
      label: "Schedule Manage",
      description: ZORA_SCHEDULE_MANAGE_DESCRIPTION,
      inputSchema: scheduleManageInputSchema,
      readOnly: false,
      execute: executeScheduleManage,
    })
  );

  return { tools };
}

/**
 * zod 是参数结构的唯一权威来源；Pi adapter 只消费这里生成的 JSON Schema，
 * 避免 Claude 与 Pi 各维护一份 schema 后再次漂移。
 */
export function toProvisionedToolJsonSchema(tool: ProvisionedTool) {
  return z.toJSONSchema(z.object(tool.inputSchema));
}
