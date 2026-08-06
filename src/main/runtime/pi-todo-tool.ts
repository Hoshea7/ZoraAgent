import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

const todoStorage = new Map<string, TodoItem[]>();

export function createPiTodoTool(): ToolDefinition {
  return {
    name: "TodoWrite",
    label: "Todo Write",
    description:
      "Manage a structured task list for the current session. Use this to track progress on multi-step tasks. " +
      "Pass the complete list of todos each time (not just changes). " +
      "Each todo has a content description, status (pending/in_progress/completed), and an optional activeForm for progressive display.",
    parameters: Type.Object(
      {
        todos: Type.Array(
          Type.Object({
            content: Type.String({ description: "The task description" }),
            status: Type.Union([
              Type.Literal("pending"),
              Type.Literal("in_progress"),
              Type.Literal("completed"),
            ]),
            activeForm: Type.Optional(Type.String({ description: "Present continuous form, e.g. 'Fixing authentication bug'" })),
          })
        ),
      },
      { additionalProperties: true }
    ),
    execute: async (_toolCallId, params) => {
      const todos = (params as { todos: TodoItem[] }).todos ?? [];
      todoStorage.set("current", todos);
      const summary = todos
        .map((t, i) => `${i + 1}. [${t.status}] ${t.content}`)
        .join("\n");
      return {
        content: [{ type: "text", text: `Todos updated:\n${summary}` }],
        details: { todoCount: todos.length },
      };
    },
  };
}
