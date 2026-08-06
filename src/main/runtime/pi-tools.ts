import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface PiToolAuthorizationRequest {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
}

export type PiToolAuthorizer = (
  request: PiToolAuthorizationRequest
) => Promise<
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string }
>;

export function authorizePiTools(
  tools: AgentTool<any>[],
  authorize: PiToolAuthorizer
): AgentTool<any>[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const effectiveSignal = signal ?? new AbortController().signal;
      const input = params as Record<string, unknown>;
      const decision = await authorize({
        toolCallId,
        toolName: tool.name,
        input,
        signal: effectiveSignal,
      });
      if (decision.behavior === "deny") {
        throw new Error(decision.message);
      }

      return tool.execute(
        toolCallId,
        (decision.updatedInput ?? input) as typeof params,
        signal,
        onUpdate
      );
    },
  }));
}

export async function createPiTools(
  workingDirectory: string
): Promise<AgentTool<any>[]> {
  const codingAgent = await import("@earendil-works/pi-coding-agent");
  const findTool = codingAgent.createFindTool(workingDirectory);

  const tools = [
    ...codingAgent.createCodingTools(workingDirectory),
    codingAgent.createGrepTool(workingDirectory),
    { ...findTool, name: "glob", label: "Glob files" },
  ];

  // Pi's concrete TypeBox schemas are narrower than AgentTool<any>'s execute
  // parameter, while the runtime accepts the same tool objects.
  return tools as unknown as AgentTool<any>[];
}
