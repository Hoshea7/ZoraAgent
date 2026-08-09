import { open } from "node:fs/promises";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ImageInputCapability } from "../../shared/types/vision";
import type { ToolRunContext } from "../../shared/types/vision";
import { attachmentResourceModule } from "../attachment-resource";

function hasImageMagic(header: Buffer): boolean {
  return (
    (header.length >= 8 &&
      header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) ||
    (header.length >= 6 && ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii"))) ||
    (header.length >= 12 &&
      header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WEBP")
  );
}

async function isImageFile(filePath: unknown): Promise<boolean> {
  if (typeof filePath !== "string" || !filePath.trim()) return false;
  try {
    const handle = await open(filePath, "r");
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      return hasImageMagic(header.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function denialReason(
  filePath: unknown,
  context?: ToolRunContext
): Promise<string> {
  const registered =
    context && typeof filePath === "string"
      ? await attachmentResourceModule.ownsPath(
          context.workspaceId,
          context.sessionId,
          filePath
        )
      : false;
  return registered
    ? "当前模型未确认支持图片输入。请使用 Inspect Image 工具读取该会话附件。"
    : "当前模型未确认支持图片输入。请先把工作区图片添加为当前会话附件，再使用 Inspect Image 工具。";
}

export function createClaudeImageReadGuardHook(
  capability: ImageInputCapability,
  context?: ToolRunContext
): HookCallback {
  return async (input) => {
    if (
      capability === "supported" ||
      input.hook_event_name !== "PreToolUse" ||
      input.tool_name.toLowerCase() !== "read"
    ) {
      return { continue: true };
    }
    const toolInput =
      typeof input.tool_input === "object" && input.tool_input !== null
        ? input.tool_input as Record<string, unknown>
        : {};
    if (!await isImageFile(toolInput.file_path ?? toolInput.path)) {
      return { continue: true };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: await denialReason(
          toolInput.file_path ?? toolInput.path,
          context
        ),
      },
    };
  };
}

export function createClaudeVisionPermissionHook(
  context?: ToolRunContext
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    if (
      input.agent_id ||
      context?.runOrigin === "schedule" ||
      context?.runOrigin === "memory"
    ) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "VISION_PERMISSION_DENIED",
        },
      };
    }
    return { continue: true };
  };
}

export function wrapPiReadTool(
  tool: ToolDefinition,
  capability: ImageInputCapability,
  runContext?: ToolRunContext
): ToolDefinition {
  if (tool.name.toLowerCase() !== "read") return tool;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, context) => {
      const input = params as Record<string, unknown>;
      if (
        capability !== "supported" &&
        await isImageFile(input.path ?? input.file_path)
      ) {
        return {
          content: [{
            type: "text",
            text: await denialReason(input.path ?? input.file_path, runContext),
          }],
          details: { blockedBy: "image-read-guard" },
          isError: true,
        };
      }
      return tool.execute(toolCallId, params, signal, onUpdate, context);
    },
  };
}
