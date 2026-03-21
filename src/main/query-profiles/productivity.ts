import { createCanUseTool } from "../hitl";
import { getSharedMcpManager } from "../mcp-manager";
import { buildZoraSystemPrompt } from "../prompt-builder";
import { resolveSdkEnvForProfile } from "./sdk-env";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";

export async function buildProductivityProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const env = await resolveSdkEnvForProfile("productivity");
  const mcpServers = await getSharedMcpManager().buildSdkMcpServers();

  const options: QueryProfile["options"] = {
    cwd: ctx.cwd,
    pathToClaudeCodeExecutable: ctx.sdkCliPath,
    executable: "node",
    executableArgs: [],
    maxTurns: 50,
    persistSession: true,
    includePartialMessages: true,
    env,
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
