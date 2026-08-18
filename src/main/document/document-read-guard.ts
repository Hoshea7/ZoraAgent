import path from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ProductToolRunContext as ToolRunContext } from "../../shared/types/product-tools";
import { attachmentResourceModule } from "../attachment-resource";
import { isSupportedDocumentPath } from "./document-format";

async function resolveInputPath(
  value: unknown,
  context?: ToolRunContext
): Promise<string | undefined> {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return path.resolve(context?.workingDirectory ?? process.cwd(), value);
}

async function documentReadInstruction(
  filePath: string,
  context?: ToolRunContext
): Promise<string> {
  const attachment = context
    ? await attachmentResourceModule.findByPath(
        context.workspaceId,
        context.sessionId,
        filePath
      )
    : null;
  if (attachment) {
    return `该文件是二进制文档。请调用 read_document，并传入 attachmentId: ${attachment.attachmentId}。`;
  }
  return `该文件是二进制文档。请调用 read_document，并传入 path: ${filePath}。`;
}

export function createClaudeDocumentReadGuardHook(
  context?: ToolRunContext
): HookCallback {
  return async (input) => {
    if (
      input.hook_event_name !== "PreToolUse" ||
      input.tool_name.toLowerCase() !== "read"
    ) {
      return { continue: true };
    }
    const toolInput =
      typeof input.tool_input === "object" && input.tool_input !== null
        ? (input.tool_input as Record<string, unknown>)
        : {};
    const filePath = await resolveInputPath(
      toolInput.file_path ?? toolInput.path,
      context
    );
    if (!filePath || !(await isSupportedDocumentPath(filePath))) {
      return { continue: true };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: await documentReadInstruction(filePath, context),
      },
    };
  };
}

export function wrapPiDocumentReadGuard(
  tool: ToolDefinition,
  context?: ToolRunContext
): ToolDefinition {
  if (tool.name.toLowerCase() !== "read") return tool;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, executionContext) => {
      const input = params as Record<string, unknown>;
      const filePath = await resolveInputPath(input.path ?? input.file_path, context);
      if (filePath && (await isSupportedDocumentPath(filePath))) {
        return {
          content: [{
            type: "text",
            text: await documentReadInstruction(filePath, context),
          }],
          details: { blockedBy: "document-read-guard" },
          isError: true,
        };
      }
      return tool.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        executionContext
      );
    },
  };
}
