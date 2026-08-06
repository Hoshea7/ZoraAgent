import { loadMessages } from "../session-store";
import { buildZoraDynamicContext } from "../prompts/zora-dynamic-context";
import { ZORA_STATIC_SYSTEM_PROMPT } from "../prompts/zora-static-system-prompt";
import type { AgentHarnessSpec, HarnessLimits } from "./types";

const PRODUCTIVITY_LIMITS: HarnessLimits = {
  maxTurns: 120,
  maxOutputTokens: 16_384,
  reasoningEffort: "medium",
};

interface ProductivityProfileDependencies {
  loadConversation: typeof loadMessages;
  buildDynamicContext: typeof buildZoraDynamicContext;
}

export interface ProductivityProfileInput {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  cwd: string;
  permissionMode: "default" | "bypassPermissions";
  modelOverrides?: Partial<HarnessLimits>;
}

export class ProductivityProfile {
  constructor(
    private readonly dependencies: ProductivityProfileDependencies = {
      loadConversation: loadMessages,
      buildDynamicContext: buildZoraDynamicContext,
    }
  ) {}

  async prepare(input: ProductivityProfileInput): Promise<AgentHarnessSpec> {
    const [messages, dynamicContext] = await Promise.all([
      this.dependencies.loadConversation(input.sessionId, input.workspaceId),
      this.dependencies.buildDynamicContext(input.workspaceId, input.cwd),
    ]);

    const limits: HarnessLimits = {
      ...PRODUCTIVITY_LIMITS,
      ...input.modelOverrides,
    };

    return {
      profileId: "productivity",
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      prompt: {
        user: input.prompt,
        dynamicContext,
        system: ZORA_STATIC_SYSTEM_PROMPT,
      },
      conversation: {
        messages,
        persistence: "durable",
      },
      workspace: { cwd: input.cwd },
      permissions: {
        mode: input.permissionMode === "bypassPermissions" ? "unattended" : "interactive",
      },
      limits,
      output: { incremental: true, visible: true },
    };
  }
}
