import { getZoraMemoryDirPath } from "../memory-store";
import { resolveSdkEnvForProfile } from "./sdk-env";
import type { SDKRuntimeOptions } from "../sdk-runtime";
import type { QueryProfile } from "./types";
import type { AgentHarnessSpec } from "../agent-profiles";
import { MEMORY_AGENT_SYSTEM_PROMPT } from "../agent-profiles/memory-profile";

export interface MemoryProfileContext {
  sdkRuntime: SDKRuntimeOptions;
  prompt?: string;
  harness?: AgentHarnessSpec;
}

export async function buildMemoryProfile(
  ctx: MemoryProfileContext
): Promise<QueryProfile> {
  const env = await resolveSdkEnvForProfile("memory");
  const harness = ctx.harness;
  const prompt = harness?.prompt.user ?? ctx.prompt;
  if (!prompt) {
    throw new Error("Memory profile requires a prompt.");
  }

  const options: QueryProfile["options"] = {
    cwd: harness?.workspace.cwd ?? getZoraMemoryDirPath(),
    pathToClaudeCodeExecutable: ctx.sdkRuntime.pathToClaudeCodeExecutable,
    executable: ctx.sdkRuntime.executable,
    executableArgs: ctx.sdkRuntime.executableArgs,
    maxTurns: harness?.limits.maxTurns ?? 7,
    persistSession: harness?.conversation.persistence === "durable",
    includePartialMessages: harness?.output.incremental ?? false,
    env: {
      ...env,
      ...ctx.sdkRuntime.env,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: harness?.prompt.system ?? MEMORY_AGENT_SYSTEM_PROMPT,
    },
    permissionMode: "bypassPermissions",
  };

  return { name: "memory", prompt, options };
}
