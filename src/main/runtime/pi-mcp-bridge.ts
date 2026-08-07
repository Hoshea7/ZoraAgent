import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getSharedMcpManager } from "../mcp-manager";
import {
  createToolProvisioningPlan,
  toProvisionedToolJsonSchema,
  type ToolProvisioningPlan,
} from "./tool-provisioning";

export function createPiToolsFromProvisioningPlan(
  plan: ToolProvisioningPlan
): ToolDefinition[] {
  return plan.tools.map((tool) => ({
    name: tool.canonicalName,
    label: tool.label,
    description: tool.description,
    parameters: Type.Unsafe(toProvisionedToolJsonSchema(tool)),
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as Record<string, unknown>;
      const result = await tool.execute(args);
      const textParts = result.content.map((content) => content.text).join("\n");
      return {
        content: [{ type: "text", text: textParts }],
        details: { isError: result.isError ?? false },
      };
    },
  }));
}

export async function createPiMcpTools(): Promise<ToolDefinition[]> {
  const config = await getSharedMcpManager().getEditableConfig();
  return createPiToolsFromProvisioningPlan(createToolProvisioningPlan(config));
}
