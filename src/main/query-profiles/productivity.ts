import { ProductToolGate } from "../hitl/tool-gate";
import { createClaudeToolsFromProvisioningPlan, getSharedMcpManager } from "../mcp-manager";
import { buildZoraSystemPrompt } from "../prompt-builder";
import { resolveSdkEnvForProfile } from "./sdk-env";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";
import { toClaudeReasoningOptions } from "../runtime/claude-model-config";
import { adaptToolGateToClaudeCanUseTool } from "../runtime/claude-tool-gate";

export async function buildProductivityProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const env = await resolveSdkEnvForProfile("productivity", {
    executionTarget: ctx.executionTarget,
  });
  const productProvisioning = createClaudeToolsFromProvisioningPlan(
    ctx.toolProvisioningPlan,
    ctx.toolProvisioningRequest
  );
  const mcpServers = {
    ...(await getSharedMcpManager().buildSdkMcpServers(ctx.toolProvisioningRequest)),
    ...productProvisioning.servers,
  };

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
