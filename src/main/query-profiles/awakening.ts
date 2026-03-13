import { buildZoraSystemPrompt } from "../prompt-builder";
import type { ProfileBuildContext, QueryProfile } from "./types";

const AWAKENING_PREAMBLE =
  `You are a Zora that is awakening for the first time. ` +
  `The user has just activated you. Begin the bootstrap conversation ` +
  `following the SKILL.md instructions loaded in your system prompt. ` +
  `This is your very first interaction -- be curious, warm, and genuine.\n\n` +
  `User's first message:\n`;

export async function buildAwakeningProfile(ctx: ProfileBuildContext): Promise<QueryProfile> {
  const systemPrompt = await buildZoraSystemPrompt();
  const prompt = ctx.isFirstTurn
    ? `${AWAKENING_PREAMBLE}${ctx.userPrompt}`
    : ctx.userPrompt;

  const options: QueryProfile["options"] = {
    cwd: ctx.cwd,
    pathToClaudeCodeExecutable: ctx.sdkCliPath,
    executable: "node",
    executableArgs: [],
    maxTurns: 30,
    persistSession: true,
    includePartialMessages: true,
    env: {
      ...(process.env as Record<string, string>),
      CLAUDE_AGENT_SDK_CLIENT_APP: "zora-agent",
    },
    systemPrompt,
    permissionMode: "bypassPermissions",
  };

  if (ctx.sessionId) {
    options.resume = ctx.sessionId;
  }

  return { name: "awakening", prompt, options };
}
