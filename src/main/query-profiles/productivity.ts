import { createCanUseTool } from "../hitl";
import { getSharedMcpManager } from "../mcp-manager";
import { buildZoraSystemPrompt } from "../prompt-builder";
import { resolveSdkEnvForProfile } from "./sdk-env";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";
import { toClaudeReasoningOptions } from "../runtime/claude-model-config";

export async function buildProductivityProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const env = await resolveSdkEnvForProfile("productivity", {
    executionTarget: ctx.executionTarget,
  });
  const mcpServers = await getSharedMcpManager().buildSdkMcpServers();

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
    strictMcpConfig: true,
    extraArgs: {
      "replay-user-messages": null,
    },
    systemPrompt: ctx.systemPromptAppend
      ? { ...systemPrompt, append: ctx.systemPromptAppend }
      : systemPrompt,
    permissionMode: "default",
    canUseTool: createCanUseTool(
      ctx.onEvent,
      ctx.localSessionId ?? "__default__"
    ) as QueryProfile["options"]["canUseTool"],
    ...toClaudeReasoningOptions(ctx.reasoningLevel ?? "medium"),
  };

  if (ctx.sessionId) {
    options.resume = ctx.sessionId;
  }

  return { name: "productivity", prompt: ctx.userPrompt, options };
}
