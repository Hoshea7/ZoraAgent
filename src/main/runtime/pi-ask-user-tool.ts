import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentStreamEvent } from "../../shared/zora";

export interface AskUserParams {
  question: string;
  header?: string;
  options?: {
    label: string;
    description?: string;
  }[];
  multiSelect?: boolean;
}

export function createPiAskUserTool(
  forwardEvent: (event: AgentStreamEvent) => void
): ToolDefinition {
  return {
    name: "AskUser",
    label: "Ask User",
    description:
      "Ask the user a question and wait for their response. Use this when you need user input, " +
      "clarification, or a decision. The question should be clear and specific. " +
      "Options are mutually exclusive unless multiSelect is true.",
    parameters: Type.Object(
      {
        question: Type.String({ description: "The question to ask the user" }),
        header: Type.Optional(Type.String({ description: "Short label (max 12 chars) for the question" })),
        options: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String({ description: "Display text for this option" }),
              description: Type.Optional(Type.String({ description: "Explanation of this option" })),
            })
          )
        ),
        multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple selections" })),
      },
      { additionalProperties: true }
    ),
    execute: async (toolCallId, params) => {
      const args = params as AskUserParams;

      return new Promise((resolve) => {
        const requestId = toolCallId;

        forwardEvent({
          type: "ask_user_request",
          requestId,
          question: args.question,
          header: args.header,
          options: args.options,
          multiSelect: args.multiSelect ?? false,
        } as AgentStreamEvent);

        const responsePromise = new Promise<string>((resolveResponse) => {
          askUserCallbacks.set(requestId, resolveResponse);
        });

        responsePromise.then((response) => {
          askUserCallbacks.delete(requestId);
          resolve({
            content: [{ type: "text", text: response }],
            details: { requestId },
          });
        });
      });
    },
  };
}

const askUserCallbacks = new Map<string, (response: string) => void>();

export function resolveAskUser(requestId: string, response: string): void {
  const callback = askUserCallbacks.get(requestId);
  if (callback) {
    callback(response);
  }
}
