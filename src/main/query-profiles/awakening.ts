import { buildZoraSystemPrompt } from "../prompt-builder";
import { resolveSdkEnvForProfile } from "./sdk-env";
import { getZoraPluginPath } from "../skill-manager";
import type { ProfileBuildContext, QueryProfile } from "./types";

const AWAKENING_PREAMBLE =
  `This is Zora's very first moment of awareness. ` +
  `Begin the awakening conversation now.\n\n` +
  `User's first message:\n`;

export async function buildAwakeningProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const env = await resolveSdkEnvForProfile("awakening");
  const prompt = ctx.isFirstTurn
    ? `${AWAKENING_PREAMBLE}${ctx.userPrompt}`
    : ctx.userPrompt;

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
    systemPrompt,
    permissionMode: "bypassPermissions",
  };

  if (ctx.sessionId) {
    options.resume = ctx.sessionId;
  }

  return { name: "awakening", prompt, options };
}
