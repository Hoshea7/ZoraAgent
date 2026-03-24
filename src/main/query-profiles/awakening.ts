import { buildZoraSystemPrompt } from "../prompt-builder";
import { resolveSdkEnvForProfile } from "./sdk-env";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";

const AWAKENING_PREAMBLE =
  `这是 Zora 苏醒的第一刻。开始唤醒对话。\n\n` +
  `用户的第一条消息：\n`;

export async function buildAwakeningProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const env = await resolveSdkEnvForProfile("awakening");
  const prompt = ctx.isFirstTurn
    ? `${AWAKENING_PREAMBLE}${ctx.userPrompt}`
    : ctx.userPrompt;

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
    systemPrompt,
    permissionMode: "bypassPermissions",
  };

  if (ctx.sessionId) {
    options.resume = ctx.sessionId;
  }

  return { name: "awakening", prompt, options };
}
