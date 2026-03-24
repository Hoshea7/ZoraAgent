import { createCanUseTool } from "../hitl";
import { getSharedMcpManager } from "../mcp-manager";
import { buildZoraSystemPrompt } from "../prompt-builder";
import { resolveSdkEnvForProfile } from "./sdk-env";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";

export async function buildProductivityProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const env = await resolveSdkEnvForProfile("productivity", {
    providerId: ctx.providerId,
    selectedModelId: ctx.selectedModelId,
  });
  const mcpServers = await getSharedMcpManager().buildSdkMcpServers();

  const options: QueryProfile["options"] = {
    cwd: ctx.cwd,
    pathToClaudeCodeExecutable: ctx.sdkRuntime.pathToClaudeCodeExecutable,
    executable: ctx.sdkRuntime.executable,
    executableArgs: ctx.sdkRuntime.executableArgs,
    maxTurns: 50,
    persistSession: true,
    includePartialMessages: true,
    env: {
      ...env,
      ...ctx.sdkRuntime.env,
    },
    plugins: [
      { type: "local" as const, path: getZoraPluginPath() },
    ],
    mcpServers,
    strictMcpConfig: true,
    systemPrompt,
    permissionMode: "default",
    canUseTool: createCanUseTool(ctx.onEvent) as QueryProfile["options"]["canUseTool"],
  };

  if (ctx.sessionId) {
    options.resume = ctx.sessionId;
  }

  return { name: "productivity", prompt: ctx.userPrompt, options };
}
