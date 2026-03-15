import { createCanUseTool } from "../hitl";
import { buildZoraSystemPrompt } from "../prompt-builder";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";

export async function buildProductivityProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();

  const options: QueryProfile["options"] = {
    cwd: ctx.cwd,
    pathToClaudeCodeExecutable: ctx.sdkCliPath,
    executable: "node",
    executableArgs: [],
    maxTurns: 50,
    persistSession: true,
    includePartialMessages: true,
    env: {
      ...(process.env as Record<string, string>),
      CLAUDE_AGENT_SDK_CLIENT_APP: "zora-agent",
    },
    plugins: [
      { type: "local" as const, path: getZoraPluginPath() },
    ],
    systemPrompt,
    permissionMode: "default",
    canUseTool: createCanUseTool(ctx.onEvent) as QueryProfile["options"]["canUseTool"],
  };

  if (ctx.sessionId) {
    options.resume = ctx.sessionId;
  }

  return { name: "productivity", prompt: ctx.userPrompt, options };
}
