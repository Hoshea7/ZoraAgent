import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ProductToolRunContext } from "../../shared/types/product-tools";
import { isDirectoryAvailable } from "../project-directory";
import { pathSyntax, relativeWithin } from "../directory-reference";
import { PROJECT_DIRECTORY_UNAVAILABLE } from "../../shared/project-directory";

type DirectoryContext = Pick<ProductToolRunContext, "workingDirectory" | "boundWorkingDirectory">;
const fileTools = new Set(["read", "write", "edit", "multiedit", "notebookedit", "glob", "grep", "find", "ls", "mcp__zora_document__read_document"]);

/** Directory availability is a tool precondition, independent of approval mode. */
export async function directoryToolError(tool: string, input: Record<string, unknown>, context?: DirectoryContext): Promise<string | undefined> {
  if (context?.boundWorkingDirectory === undefined) return undefined;
  const name = tool.toLowerCase();
  if (name !== "bash" && !fileTools.has(name)) return undefined;
  const bound = context.boundWorkingDirectory;
  if (bound === context.workingDirectory && await isDirectoryAvailable(bound)) return undefined;
  if (name === "mcp__zora_document__read_document" && (input.attachmentId || input.cursor)) return undefined;
  const target = input.file_path ?? input.path ?? input.notebook_path;
  // Explicit files outside the unavailable project (including saved attachments) remain usable.
  if (name !== "bash" && typeof target === "string" && pathSyntax(target).isAbsolute(target)
      && relativeWithin(context.workingDirectory, target) === undefined
      && (!bound || relativeWithin(bound, target) === undefined)) return undefined;
  return `${PROJECT_DIRECTORY_UNAVAILABLE}，请通过编辑项目或选择工作目录重新关联后执行此操作。可以继续讨论或使用可访问的附件。`;
}

export function wrapPiDirectoryGuard(tool: ToolDefinition, context?: DirectoryContext): ToolDefinition {
  return { ...tool, execute: async (id, params, signal, ...rest) => {
    const error = await directoryToolError(tool.name, (params ?? {}) as Record<string, unknown>, context);
    if (error) throw new Error(error);
    return tool.execute(id, params, signal, ...rest);
  } };
}

export function createClaudeDirectoryGuardHook(context?: DirectoryContext): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    const params = typeof input.tool_input === "object" && input.tool_input !== null ? input.tool_input as Record<string, unknown> : {};
    const error = await directoryToolError(input.tool_name, params, context);
    return error ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: error } } : { continue: true };
  };
}
