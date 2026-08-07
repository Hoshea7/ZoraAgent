import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import {
  parseAskUserQuestionSpecs,
  type ToolGate,
} from "./tool-gate";

export function adaptToolGateToClaudeCanUseTool(gate: ToolGate): CanUseTool {
  return async (toolName, input, options) => {
    if (toolName === "AskUserQuestion") {
      try {
        const answers = await gate.ask({
          questions: parseAskUserQuestionSpecs(input),
          callId: options.toolUseID,
          signal: options.signal,
        });
        return {
          behavior: "allow",
          updatedInput: { ...input, answers },
        };
      } catch (error) {
        return {
          behavior: "deny",
          message: error instanceof Error ? error.message : "操作已中止",
        };
      }
    }

    const decision = await gate.authorize({
      tool: toolName,
      input,
      callId: options.toolUseID,
      signal: options.signal,
      agentId: options.agentID,
    });

    if (decision.behavior === "deny") {
      return decision;
    }

    return {
      behavior: "allow",
      updatedInput: decision.input ?? input,
    };
  };
}
