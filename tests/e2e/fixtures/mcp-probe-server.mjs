import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "zora-e2e-probe", version: "1.0.0" });

server.registerTool(
  "read_probe_value",
  {
    description: "Return the public deterministic value used by the E2E MCP probe.",
  },
  async () => ({
    content: [{
      type: "text",
      text: process.env.ZORA_MCP_PROBE_VALUE ?? "MISSING_MCP_PROBE_VALUE",
    }],
  })
);

await server.connect(new StdioServerTransport());
