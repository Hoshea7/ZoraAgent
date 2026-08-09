import type { AgentStreamEvent } from "@/shared/zora";
import { MCP_BUILTINS, type McpConfig } from "@/shared/types/mcp";
import {
  clearAllPending,
  clearSessionWhitelist,
  respondToPermission,
  setPermissionMode,
} from "@/main/hitl";
import { ProductToolGate } from "@/main/hitl/tool-gate";
import { createClaudeToolsFromProvisioningPlan } from "@/main/mcp-manager";
import {
  createPiToolsFromProvisioningPlan,
} from "@/main/runtime/pi-mcp-bridge";
import {
  createToolProvisioningPlan,
  toProvisionedToolJsonSchema,
} from "@/main/runtime/tool-provisioning";

const EXPECTED_TOOL_NAMES = [
  "mcp__zora_web_search__web_search",
  "mcp__zora_web_fetch__web_fetch",
  "mcp__zora_schedule__zora_schedule_manage",
];

function createEnabledBuiltinConfig(): McpConfig {
  return {
    servers: {
      [MCP_BUILTINS.web_search.serverName]: {
        type: "sdk",
        enabled: true,
        isBuiltin: true,
        builtinKey: "web_search",
      },
      [MCP_BUILTINS.web_fetch.serverName]: {
        type: "sdk",
        enabled: true,
        isBuiltin: true,
        builtinKey: "web_fetch",
      },
    },
  };
}

function permissionRequest(events: AgentStreamEvent[]) {
  return events.find((event) => event.type === "permission_request");
}

afterEach(() => {
  clearAllPending();
  setPermissionMode("ask");
  for (const runtime of ["claude", "pi"]) {
    for (const action of ["list", "get"]) {
      clearSessionWhitelist(`tool-provisioning-${runtime}-${action}`);
    }
  }
});

describe("ToolProvisioning adapter parity", () => {
  it("exposes the same canonical tool names in Claude and Pi", () => {
    const plan = createToolProvisioningPlan(createEnabledBuiltinConfig());
    const claude = createClaudeToolsFromProvisioningPlan(plan);
    const pi = createPiToolsFromProvisioningPlan(plan);

    expect(new Set(claude.toolNames)).toEqual(new Set(EXPECTED_TOOL_NAMES));
    expect(new Set(pi.map((tool) => tool.name))).toEqual(new Set(claude.toolNames));
  });

  it("preserves the complete authoritative zod schema in Pi parameters", () => {
    const plan = createToolProvisioningPlan(createEnabledBuiltinConfig());
    const piTools = createPiToolsFromProvisioningPlan(plan);
    const piByName = new Map(piTools.map((tool) => [tool.name, tool]));

    for (const provisionedTool of plan.tools) {
      const piTool = piByName.get(provisionedTool.canonicalName);
      expect(piTool).toBeDefined();

      const piSchema = JSON.parse(JSON.stringify(piTool?.parameters));
      const authoritativeSchema = toProvisionedToolJsonSchema(provisionedTool);
      expect(piSchema).toEqual(authoritativeSchema);
      expect(Object.keys(piSchema.properties ?? {})).not.toHaveLength(0);
    }

    expect(
      toProvisionedToolJsonSchema(
        plan.tools.find((tool) => tool.toolName === "web_search")!
      ).required
    ).toEqual(["query"]);
    expect(
      toProvisionedToolJsonSchema(
        plan.tools.find((tool) => tool.toolName === "web_fetch")!
      ).required
    ).toEqual(["url"]);

    const scheduleSchema = toProvisionedToolJsonSchema(
      plan.tools.find((tool) => tool.toolName === "zora_schedule_manage")!
    );
    expect(scheduleSchema.required).toEqual(["action"]);
    expect(scheduleSchema.properties?.schedule).toMatchObject({
      anyOf: [
        { required: ["type", "runAt"] },
        { required: ["type"] },
        { required: ["type", "time"] },
        { required: ["type", "time"] },
        { required: ["type", "weekdays", "time"] },
      ],
    });
  });

  it.each(["claude", "pi"] as const)(
    "auto-allows schedule list/get through the %s-provisioned name",
    async (runtime) => {
      const plan = createToolProvisioningPlan(createEnabledBuiltinConfig());
      const claude = createClaudeToolsFromProvisioningPlan(plan);
      const pi = createPiToolsFromProvisioningPlan(plan);
      const toolName = runtime === "claude"
        ? claude.toolNames.find((name) => name.includes("zora_schedule_manage"))
        : pi.find((tool) => tool.name.includes("zora_schedule_manage"))?.name;

      expect(toolName).toBe("mcp__zora_schedule__zora_schedule_manage");

      for (const action of ["list", "get"] as const) {
        const events: AgentStreamEvent[] = [];
        const gate = new ProductToolGate(
          (event) => events.push(event),
          `tool-provisioning-${runtime}-${action}`,
          new Set()
        );
        const decision = gate.authorize({
          tool: toolName!,
          input: action === "list" ? { action } : { action, taskId: "task-1" },
          callId: `${runtime}-${action}`,
          signal: new AbortController().signal,
        });
        const unexpectedRequest = permissionRequest(events);
        if (unexpectedRequest?.type === "permission_request") {
          respondToPermission(unexpectedRequest.request.requestId, "deny", false);
        }

        await expect(decision).resolves.toEqual({ behavior: "allow" });
        expect(events).toEqual([]);
      }
    }
  );
});
