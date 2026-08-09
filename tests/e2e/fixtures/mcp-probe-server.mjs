import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "zora-e2e-probe", version: "1.0.0" });

server.registerTool(
  "read_probe_token",
  {
    description: "Return the exact private probe token from this MCP server.",
  },
  async () => ({
    content: [{
      type: "text",
      text: process.env.ZORA_MCP_PROBE_TOKEN ?? "MISSING_MCP_PROBE_TOKEN",
    }],
  })
);

await server.connect(new StdioServerTransport());
