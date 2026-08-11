import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getSharedMcpManager } from "../mcp-manager";
import type { McpConfig, McpServerEntry } from "../../shared/types/mcp";
import {
  createToolCallContext,
  toCanonicalMcpToolName,
  toProvisionedToolJsonSchema,
  type ToolProvisioningPlan,
} from "./tool-provisioning";

const DEFAULT_MCP_TIMEOUT_SECONDS = 30;

interface ExternalMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface ExternalMcpResult {
  content?: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface PiMcpToolClient {
  listTools(serverName: string, config: McpServerEntry): Promise<ExternalMcpTool[]>;
  callTool(
    serverName: string,
    config: McpServerEntry,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ExternalMcpResult>;
  dispose(): Promise<void> | void;
}

interface McpConnection {
  client: Client;
  transport: Transport;
}

function connectionKey(serverName: string, config: McpServerEntry): string {
  return `${serverName}:${JSON.stringify({
    type: config.type,
    command: config.command,
    args: config.args,
    url: config.url,
    headers: config.headers,
    env: config.env,
    timeout: config.timeout,
  })}`;
}

function transportFor(config: McpServerEntry): Transport {
  if (config.type === "stdio") {
    if (!config.command) throw new Error("stdio MCP server 缺少 command");
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      stderr: "inherit",
    });
  }

  if (!config.url) throw new Error(`${config.type} MCP server 缺少 url`);
  const requestInit = config.headers ? { headers: config.headers } : undefined;
  if (config.type === "http") {
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit });
  }
  if (config.type === "sse") {
    return new SSEClientTransport(new URL(config.url), { requestInit });
  }
  throw new Error(`Pi Runtime 不支持 ${config.type} MCP transport`);
}

class DefaultPiMcpToolClient implements PiMcpToolClient {
  private readonly connections = new Map<string, Promise<McpConnection>>();

  async listTools(serverName: string, config: McpServerEntry) {
    const { client } = await this.connection(serverName, config);
    const result = await client.listTools(undefined, {
      timeout: (config.timeout ?? DEFAULT_MCP_TIMEOUT_SECONDS) * 1000,
    });
    return result.tools as ExternalMcpTool[];
  }

  async callTool(
    serverName: string,
    config: McpServerEntry,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) {
    const { client } = await this.connection(serverName, config);
    return client.callTool(
      { name: toolName, arguments: args },
      undefined,
      {
        signal: signal ?? new AbortController().signal,
        timeout: (config.timeout ?? DEFAULT_MCP_TIMEOUT_SECONDS) * 1000,
        resetTimeoutOnProgress: true,
      }
    ) as Promise<ExternalMcpResult>;
  }

  async dispose(): Promise<void> {
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(
      connections.map(async (connection) => {
        const { transport } = await connection;
        await transport.close();
      })
    );
  }

  private connection(
    serverName: string,
    config: McpServerEntry
  ): Promise<McpConnection> {
    const key = connectionKey(serverName, config);
    const existing = this.connections.get(key);
    if (existing) return existing;

    const pending = this.open(serverName, config).catch((error) => {
      this.connections.delete(key);
      throw error;
    });
    this.connections.set(key, pending);
    return pending;
  }

  private async open(
    serverName: string,
    config: McpServerEntry
  ): Promise<McpConnection> {
    const transport = transportFor(config);
    const client = new Client(
      { name: `zora-pi-mcp-${serverName}`, version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport, {
      timeout: (config.timeout ?? DEFAULT_MCP_TIMEOUT_SECONDS) * 1000,
    });
    return { client, transport };
  }
}

const externalMcpClient = new DefaultPiMcpToolClient();

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toPiToolResult(result: ExternalMcpResult): AgentToolResult<unknown> {
  const content: Array<TextContent | ImageContent> = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
    } else if (
      block.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      content.push({ type: "image", data: block.data, mimeType: block.mimeType });
    } else {
      content.push({ type: "text", text: stringify(block) });
    }
  }
  if (result.structuredContent !== undefined) {
    content.push({
      type: "text",
      text: `structuredContent:\n${stringify(result.structuredContent)}`,
    });
  }
  if (content.length === 0) {
    content.push({ type: "text", text: stringify(result) });
  }
  return { content, details: result };
}

export async function createPiExternalMcpTools(
  config: McpConfig,
  client: PiMcpToolClient
): Promise<ToolDefinition[]> {
  const servers = Object.entries(config.servers).filter(([, entry]) =>
    entry.enabled && !entry.isBuiltin && entry.type !== "sdk"
  );
  const listedTools = await Promise.all(
    servers.map(async ([serverName, entry]) => ({
      serverName,
      entry,
      tools: await client.listTools(serverName, entry),
    }))
  );

  return listedTools.flatMap(({ serverName, entry, tools }) =>
    tools.map((tool): ToolDefinition => ({
      name: toCanonicalMcpToolName(serverName, tool.name),
      label: tool.name,
      description: tool.description ?? `调用 ${serverName} 的 ${tool.name} MCP 工具`,
      parameters: Type.Unsafe(
        tool.inputSchema?.type === "object"
          ? tool.inputSchema
          : { type: "object", properties: {} }
      ),
      execute: async (_toolCallId, rawParams, signal) =>
        toPiToolResult(await client.callTool(
          serverName,
          entry,
          tool.name,
          (rawParams ?? {}) as Record<string, unknown>,
          signal
        )),
    }))
  );
}

export function createPiToolsFromProvisioningPlan(
  plan: ToolProvisioningPlan
): ToolDefinition[] {
  return plan.tools.map((tool) => ({
    name: tool.canonicalName,
    label: tool.label,
    description: tool.description,
    parameters: Type.Unsafe(toProvisionedToolJsonSchema(tool)),
    execute: async (toolCallId, rawParams, signal) => {
      const args = (rawParams ?? {}) as Record<string, unknown>;
      const result = await tool.execute(
        args,
        createToolCallContext(plan.runContext, signal, undefined, `pi:${toolCallId}`)
      );
      return {
        content: result.content.map((content) =>
          content.type === "text"
            ? { type: "text" as const, text: content.text }
            : {
                type: "image" as const,
                data: content.data,
                mimeType: content.mimeType,
              }
        ),
        details: { isError: result.isError ?? false },
      };
    },
  }));
}

export async function createPiMcpTools(
  plan: ToolProvisioningPlan
): Promise<ToolDefinition[]> {
  const config = await getSharedMcpManager().getEditableConfig();
  const productTools = createPiToolsFromProvisioningPlan(plan);
  const externalTools = await createPiExternalMcpTools(config, externalMcpClient);
  return [...productTools, ...externalTools];
}

export function disposePiMcpConnections(): void {
  void externalMcpClient.dispose();
}
