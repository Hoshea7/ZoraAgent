import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ReasoningLevel } from "../../shared/zora";

type ClaudeReasoningOptions = Pick<Options, "thinking" | "effort">;

/** Translate the product-level setting to Claude Agent SDK native options. */
export function toClaudeReasoningOptions(
  level: ReasoningLevel
): ClaudeReasoningOptions {
  if (level === "off") {
    return { thinking: { type: "disabled" } };
  }

  return {
    thinking: { type: "adaptive" },
    effort: level, // "high" | "max" — both are valid Claude SDK effort values
  };
}
