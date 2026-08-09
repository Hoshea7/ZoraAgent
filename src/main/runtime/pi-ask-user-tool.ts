import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  parseAskUserQuestionSpecs,
  type ToolGate,
} from "./tool-gate";

const optionSchema = Type.Object({
  label: Type.String({ description: "Display text for this option" }),
  description: Type.Optional(
    Type.String({ description: "Explanation of this option" })
  ),
});

export function createPiAskUserQuestionTool(gate: ToolGate): ToolDefinition {
  return {
    name: "AskUserQuestion",
    label: "Ask User Question",
    description:
      "Ask the user one or more questions and wait for their answers. " +
      "Pass either question for one question or questions for multiple questions. " +
      "Each question may include mutually exclusive options.",
    parameters: Type.Object(
      {
        question: Type.Optional(
          Type.String({ description: "A single question to ask the user" })
        ),
        options: Type.Optional(Type.Array(optionSchema)),
        questions: Type.Optional(
          Type.Array(
            Type.Object({
              question: Type.String({ description: "The question to ask" }),
              options: Type.Optional(Type.Array(optionSchema)),
            })
          )
        ),
      },
      {
        additionalProperties: false,
        description: "Provide question or questions; at least one is required.",
      }
    ),
    execute: async (toolCallId, params, signal) => {
      const answers = await gate.ask({
        questions: parseAskUserQuestionSpecs(params as Record<string, unknown>),
        callId: toolCallId,
        signal: signal ?? new AbortController().signal,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(answers) }],
        details: { requestId: toolCallId, answers },
      };
    },
  };
}
