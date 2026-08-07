import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { PI_TOOL_NAME_MAP, normalizePiToolInput } from "./pi-event-mapper";
import { authorizeTools, type ToolGate } from "./tool-gate";

export function adaptToolGateToPiTools(
  tools: readonly ToolDefinition[],
  gate: ToolGate
): ToolDefinition[] {
  return authorizeTools(tools, gate, {
    canonicalizeToolName: (toolName) =>
      PI_TOOL_NAME_MAP[toolName.toLowerCase()] ?? toolName,
    normalizeInput: normalizePiToolInput,
  });
}
