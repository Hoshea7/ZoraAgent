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

const WEB_FETCH_BUILTIN = MCP_BUILTINS.web_fetch;
const JINA_READER_BASE_URL = "https://r.jina.ai/";
const JINA_API_KEY_ENV_NAME = WEB_FETCH_BUILTIN.envKey;
const WEB_FETCH_TOOL_NAME = WEB_FETCH_BUILTIN.toolName;
const WEB_FETCH_TOOL_DESCRIPTION =
  "Fetch a URL and extract its full content as clean, readable Markdown. Use this when you have a specific URL and need to read the complete page content. Common scenarios: the user shares a link and asks what does this say, reading documentation or articles, extracting content from GitHub READMEs, or any case where you need the actual page text rather than a brief snippet. Automatically strips ads, navigation, and other noise";

function buildTestResult(success: boolean, message: string): McpServerTestResult {
  return { success, message };
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateText(value: string, maxChars = 320): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function normalizeUrl(url: string): string {
  const normalized = url.trim();
  if (!normalized) {
    throw new Error("请填写 URL");
  }

  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只支持 http / https URL");
  }

  return parsed.toString();
}

function getJinaApiKey(entry: McpServerEntry): string {
  return entry.env?.[JINA_API_KEY_ENV_NAME]?.trim() ?? "";
}

async function runJinaReader(apiKey: string, url: string): Promise<string> {
  const normalizedUrl = normalizeUrl(url);
  const response = await fetch(`${JINA_READER_BASE_URL}${normalizedUrl}`, {
    method: "GET",
    headers: {
      Accept: "text/plain, text/markdown;q=0.9, text/html;q=0.8",
      Authorization: `Bearer ${apiKey}`,
      "X-Respond-With": "markdown",
    },
    signal: AbortSignal.timeout(15_000),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${truncateText(responseText || response.statusText)}`);
  }

  const markdown = responseText.trim();
  if (!markdown) {
    throw new Error("Jina Reader 未返回正文内容");
  }

  return markdown;
}

export function isBuiltinWebFetchEntry(entry: McpServerEntry): boolean {
  return entry.type === "sdk" && entry.isBuiltin === true && entry.builtinKey === "web_fetch";
}

export function createBuiltinWebFetchEntry(existing?: Partial<McpServerEntry>): McpServerEntry {
  return {
    type: "sdk",
    enabled: existing?.enabled ?? false,
    isBuiltin: true,
    builtinKey: "web_fetch",
    env: existing?.env ? { ...existing.env } : undefined,
    timeout: existing?.timeout ?? 30,
    lastTestResult: existing?.lastTestResult ? { ...existing.lastTestResult } : undefined,
  };
}

export async function testBuiltinWebFetch(entry: McpServerEntry): Promise<McpServerTestResult> {
  const apiKey = getJinaApiKey(entry);
  if (!apiKey) {
    return buildTestResult(false, "请填写 Jina API Key");
  }

  try {
    const markdown = await runJinaReader(apiKey, "https://example.com");
    return buildTestResult(
      true,
      markdown.length > 0
        ? `连接成功: Jina Web Fetch 可用 · 返回 ${markdown.length} 字符`
        : "连接成功: Jina Web Fetch 可用"
    );
  } catch (error) {
    return buildTestResult(false, extractErrorMessage(error));
  }
}

export function createBuiltinWebFetchServer(
  entry: McpServerEntry
): McpSdkServerConfigWithInstance {
  const apiKey = getJinaApiKey(entry);

  return createSdkMcpServer({
    name: WEB_FETCH_BUILTIN.serverName,
    version: "1.0.0",
    tools: [
      tool(
        WEB_FETCH_TOOL_NAME,
        WEB_FETCH_TOOL_DESCRIPTION,
        {
          url: z
            .string()
            .min(1)
            .describe("The full URL to fetch and convert into clean Markdown."),
        },
        async (args) => {
          if (!apiKey) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Jina API Key 未配置，请先在设置中配置并启用 Web Fetch。",
                },
              ],
            };
          }

          try {
            const markdown = await runJinaReader(apiKey, args.url);

            return {
              content: [
                {
                  type: "text",
                  text: markdown,
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

export { JINA_API_KEY_ENV_NAME };
