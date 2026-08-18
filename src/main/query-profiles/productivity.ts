import { ProductToolGate } from "../hitl/tool-gate";
import { getSharedMcpManager } from "../mcp-manager";
import { buildZoraSystemPrompt } from "../prompt-builder";
import { resolveSdkEnvForProfile } from "./sdk-env";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";
import { toClaudeReasoningOptions } from "../runtime/claude-model-config";
import { adaptToolGateToClaudeCanUseTool } from "../runtime/claude-tool-gate";
import {
  createClaudeImageReadGuardHook,
  createClaudeVisionPermissionHook,
} from "../vision/image-read-guard";
import { createClaudeDocumentReadGuardHook } from "../document/document-read-guard";

export async function buildProductivityProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const env = await resolveSdkEnvForProfile("productivity", {
    executionTarget: ctx.executionTarget,
  });
  const mcpServers = await getSharedMcpManager().buildSdkMcpServers(
    ctx.toolProvisioningPlan
  );
  const imageInputCapability =
    ctx.toolRunContext?.vision.imageInputCapability ?? "unknown";

  const options: QueryProfile["options"] = {
    cwd: ctx.cwd,
    pathToClaudeCodeExecutable: ctx.sdkRuntime.pathToClaudeCodeExecutable,
    executable: ctx.sdkRuntime.executable,
    executableArgs: ctx.sdkRuntime.executableArgs,
    maxTurns: ctx.maxTurns ?? 500,
    persistSession: true,
    includePartialMessages: true,
    env: {
      ...env,
      ...ctx.sdkRuntime.env,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
    plugins: [
      { type: "local" as const, path: getZoraPluginPath() },
    ],
    mcpServers,
    hooks: {
      PreToolUse: [{
        matcher: "Read",
        hooks: [
          createClaudeDocumentReadGuardHook(ctx.toolRunContext),
          createClaudeImageReadGuardHook(imageInputCapability, ctx.toolRunContext),
        ],
      }, {
        matcher: "mcp__zora_vision__inspect_image",
        hooks: [createClaudeVisionPermissionHook(ctx.toolRunContext)],
      }],
    },
    strictMcpConfig: true,
    disallowedTools: ["Task", "Agent", "TaskStop"],
    extraArgs: {
      "replay-user-messages": null,
    },
    systemPrompt: ctx.systemPromptAppend
      ? { ...systemPrompt, append: ctx.systemPromptAppend }
      : systemPrompt,
    permissionMode: "default",
    canUseTool: adaptToolGateToClaudeCanUseTool(
      ctx.toolGate ??
        new ProductToolGate(
          ctx.onEvent,
          ctx.localSessionId ?? "__default__",
          new Set(
            ctx.toolProvisioningPlan.tools
              .filter((tool) => tool.approvalPolicy === "auto")
              .map((tool) => tool.canonicalName)
          )
        )
    ),
    ...toClaudeReasoningOptions(ctx.reasoningLevel ?? "high"),
  };

  if (ctx.sessionId) {
    options.resume = ctx.sessionId;
  }

  return { name: "productivity", prompt: ctx.userPrompt, options };
}
