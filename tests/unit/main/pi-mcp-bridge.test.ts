import {
  createPiExternalMcpTools,
  type PiMcpToolClient,
} from "@/main/runtime/pi-mcp-bridge";
import type { McpConfig } from "@/shared/types/mcp";

function config(): McpConfig {
  return {
    servers: {
      files: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "secret" },
        enabled: true,
      },
      disabled: {
        type: "http",
        url: "https://example.com/mcp",
        enabled: false,
      },
      builtin: {
        type: "sdk",
        enabled: true,
        isBuiltin: true,
        builtinKey: "web_search",
      },
    },
  };
}

describe("createPiExternalMcpTools", () => {
  it("lists enabled user servers and exposes their tools with the shared canonical name", async () => {
    const client: PiMcpToolClient = {
      listTools: vi.fn(async () => [{
        name: "read_secret",
        description: "Read a test secret",
        inputSchema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
      }]),
      callTool: vi.fn(),
      dispose: vi.fn(),
    };

    const tools = await createPiExternalMcpTools(config(), client);

    expect(client.listTools).toHaveBeenCalledOnce();
    expect(client.listTools).toHaveBeenCalledWith("files", config().servers.files);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "mcp__files__read_secret",
      label: "read_secret",
      description: "Read a test secret",
    });
    expect(JSON.parse(JSON.stringify(tools[0]?.parameters))).toEqual({
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    });
  });

  it("executes the original MCP tool and preserves text, image, structured data, and error state", async () => {
    const client: PiMcpToolClient = {
      listTools: vi.fn(async () => [{
        name: "inspect",
        inputSchema: { type: "object", properties: {} },
      }]),
      callTool: vi.fn(async () => ({
        content: [
          { type: "text", text: "alpha" },
          { type: "image", data: "AQID", mimeType: "image/png" },
        ],
        structuredContent: { count: 1 },
        isError: true,
      })),
      dispose: vi.fn(),
    };
    const [tool] = await createPiExternalMcpTools(config(), client);

    const result = await tool!.execute(
      "call-1",
      { path: "notes.txt" },
      new AbortController().signal,
      () => undefined
    );

    expect(client.callTool).toHaveBeenCalledWith(
      "files",
      config().servers.files,
      "inspect",
      { path: "notes.txt" },
      expect.any(AbortSignal)
    );
    expect(result.content).toEqual([
      { type: "text", text: "alpha" },
      { type: "image", data: "AQID", mimeType: "image/png" },
      { type: "text", text: 'structuredContent:\n{\n  "count": 1\n}' },
    ]);
    expect(result.details).toMatchObject({ isError: true });
  });

  it("surfaces connection failures instead of silently removing an enabled server", async () => {
    const client: PiMcpToolClient = {
      listTools: vi.fn(async () => { throw new Error("connection refused"); }),
      callTool: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(createPiExternalMcpTools(config(), client)).rejects.toThrow(
      "connection refused"
    );
  });
});
