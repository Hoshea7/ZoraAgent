import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  MCP_BUILTINS,
  type McpServerEntry,
  type McpServerTestResult,
} from "../../shared/types/mcp";
import { isRecord } from "../utils/guards";

const WEB_SEARCH_BUILTIN = MCP_BUILTINS.web_search;
const TAVILY_API_URL = "https://api.tavily.com/search";
const TAVILY_API_KEY_ENV_NAME = WEB_SEARCH_BUILTIN.envKey;
const WEB_SEARCH_TOOL_NAME = WEB_SEARCH_BUILTIN.toolName;
const WEB_SEARCH_TOOL_DESCRIPTION =
  "Search the web for real-time information. Use this when you need current data that may not be in your training knowledge: recent news, live prices, today's weather, latest documentation, or any factual question where freshness matters. Returns a ranked list of results with titles, URLs, and content snippets — often sufficient to answer the question directly without further steps.";

type TavilyTopic = "general" | "news";

interface TavilySearchResultItem {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilySearchResponse {
  answer?: string;
  results?: TavilySearchResultItem[];
}

function buildTestResult(success: boolean, message: string): McpServerTestResult {
  return { success, message };
}

function getTavilyApiKey(entry: McpServerEntry): string {
  return entry.env?.[TAVILY_API_KEY_ENV_NAME]?.trim() ?? "";
}

function truncateText(value: string, maxChars = 240): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTavilyError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) {
    return fallback;
  }

  if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
    return payload.detail.trim();
  }

  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error.trim();
  }

  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message.trim();
  }

  return fallback;
}

async function runTavilySearch(
  apiKey: string,
  options: {
    query: string;
    topic?: TavilyTopic;
    maxResults?: number;
  }
): Promise<TavilySearchResponse> {
  const response = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: options.query,
      topic: options.topic ?? "general",
      max_results: options.maxResults ?? 5,
      search_depth: "basic",
      include_answer: true,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const responseText = await response.text();
  let parsed: unknown = null;

  if (responseText.trim().length > 0) {
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // keep parsed as null
    }
  }

  if (!response.ok) {
    throw new Error(
      parseTavilyError(parsed, `HTTP ${response.status}: ${truncateText(responseText || response.statusText)}`)
    );
  }

  if (parsed && isRecord(parsed)) {
    return parsed as TavilySearchResponse;
  }

  return {};
}

function formatSearchResults(data: TavilySearchResponse): string {
  const sections: string[] = [];

  if (typeof data.answer === "string" && data.answer.trim().length > 0) {
    sections.push(`概览:\n${data.answer.trim()}`);
  }

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length > 0) {
    sections.push(
      [
        "结果:",
        ...results.map((item, index) => {
          const title = item.title?.trim() || "Untitled";
          const url = item.url?.trim() || "N/A";
          const snippet = item.content?.trim() || "No snippet";

          return `${index + 1}. ${title}\nURL: ${url}\n摘要: ${truncateText(snippet, 320)}`;
        }),
      ].join("\n\n")
    );
  }

  if (sections.length === 0) {
    return "Tavily 已连接，但没有返回可展示的搜索结果。";
  }

  return sections.join("\n\n");
}

export function isBuiltinWebSearchEntry(entry: McpServerEntry): boolean {
  return entry.type === "sdk" && entry.isBuiltin === true && entry.builtinKey === "web_search";
}

export function createBuiltinWebSearchEntry(existing?: Partial<McpServerEntry>): McpServerEntry {
  return {
    type: "sdk",
    enabled: existing?.enabled ?? false,
    isBuiltin: true,
    builtinKey: "web_search",
    env: existing?.env ? { ...existing.env } : undefined,
    timeout: existing?.timeout ?? 30,
    lastTestResult: existing?.lastTestResult ? { ...existing.lastTestResult } : undefined,
  };
}

export async function testBuiltinWebSearch(entry: McpServerEntry): Promise<McpServerTestResult> {
  const apiKey = getTavilyApiKey(entry);
  if (!apiKey) {
    return buildTestResult(false, "请填写 Tavily API Key");
  }

  try {
    const result = await runTavilySearch(apiKey, {
      query: "today's technology headlines",
      topic: "news",
      maxResults: 1,
    });

    const resultCount = Array.isArray(result.results) ? result.results.length : 0;
    return buildTestResult(
      true,
      resultCount > 0
        ? `连接成功: Tavily Web Search 可用 · 返回 ${resultCount} 条结果`
        : "连接成功: Tavily Web Search 可用"
    );
  } catch (error) {
    return buildTestResult(false, extractErrorMessage(error));
  }
}

export function createBuiltinWebSearchServer(
  entry: McpServerEntry
): McpSdkServerConfigWithInstance {
  const apiKey = getTavilyApiKey(entry);

  return createSdkMcpServer({
    name: WEB_SEARCH_BUILTIN.serverName,
    version: "1.0.0",
    tools: [
      tool(
        WEB_SEARCH_TOOL_NAME,
        WEB_SEARCH_TOOL_DESCRIPTION,
        {
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
        },
        async (args) => {
          if (!apiKey) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Tavily API Key 未配置，请先在设置中配置并启用 Web Search。",
                },
              ],
            };
          }

          try {
            const result = await runTavilySearch(apiKey, {
              query: args.query,
              topic: args.topic,
              maxResults: args.max_results,
            });

            return {
              content: [
                {
                  type: "text",
                  text: formatSearchResults(result),
                },
              ],
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: extractErrorMessage(error),
                },
              ],
            };
          }
        }
      ),
    ],
  });
}

export { TAVILY_API_KEY_ENV_NAME };
