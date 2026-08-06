import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getSharedMcpManager } from "../mcp-manager";
import { MCP_BUILTINS, type McpServerEntry } from "../../shared/types/mcp";
import {
  ZORA_SCHEDULE_MANAGE_TOOL_NAME,
  ZORA_SCHEDULE_MANAGE_DESCRIPTION,
  handleScheduleManage,
} from "../builtin-mcp/schedule";
import {
  executeWebSearch,
  WEB_SEARCH_TOOL_DESCRIPTION,
  TAVILY_API_KEY_ENV_NAME,
} from "../builtin-mcp/web-search";
import {
  executeWebFetch,
  WEB_FETCH_TOOL_DESCRIPTION,
  JINA_API_KEY_ENV_NAME,
} from "../builtin-mcp/web-fetch";

type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function envApiKey(entry: McpServerEntry | undefined, key: string): string {
  return entry?.env?.[key]?.trim() ?? "";
}

function toToolDefinition(params: {
  name: string;
  label: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<McpToolResult>;
}): ToolDefinition {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as Record<string, unknown>;
      const result = await params.execute(args);
      const textParts = result.content.map((c) => c.text).join("\n");
      return {
        content: [{ type: "text", text: textParts }],
        details: { isError: result.isError ?? false },
      };
    },
  };
}

export async function createPiMcpTools(): Promise<ToolDefinition[]> {
  const mcpManager = getSharedMcpManager();
  const config = await mcpManager.getConfig();
  const tools: ToolDefinition[] = [];

  const webSearchEntry = config.servers[MCP_BUILTINS.web_search.serverName];
  if (webSearchEntry?.enabled) {
    const apiKey = envApiKey(webSearchEntry, TAVILY_API_KEY_ENV_NAME);
    tools.push(
      toToolDefinition({
        name: MCP_BUILTINS.web_search.toolName,
        label: "Web Search",
        description: WEB_SEARCH_TOOL_DESCRIPTION,
        execute: async (args) => {
          return executeWebSearch(apiKey, {
            query: String(args.query ?? ""),
            topic: args.topic as "general" | "news" | undefined,
            max_results: args.max_results as number | undefined,
          });
        },
      })
    );
  }

  const webFetchEntry = config.servers[MCP_BUILTINS.web_fetch.serverName];
  if (webFetchEntry?.enabled) {
    const apiKey = envApiKey(webFetchEntry, JINA_API_KEY_ENV_NAME);
    tools.push(
      toToolDefinition({
        name: MCP_BUILTINS.web_fetch.toolName,
        label: "Web Fetch",
        description: WEB_FETCH_TOOL_DESCRIPTION,
        execute: async (args) => {
          return executeWebFetch(apiKey, {
            url: String(args.url ?? ""),
          });
        },
      })
    );
  }

  tools.push(
    toToolDefinition({
      name: ZORA_SCHEDULE_MANAGE_TOOL_NAME,
      label: "Schedule Manage",
      description: ZORA_SCHEDULE_MANAGE_DESCRIPTION,
      execute: async (args) => {
        try {
          return await handleScheduleManage(args as unknown as Parameters<typeof handleScheduleManage>[0]);
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          };
        }
      },
    })
  );

  return tools;
}
