import { loadMessages } from "../session-store";
import { buildZoraDynamicContext } from "../prompts/zora-dynamic-context";
import { ZORA_STATIC_SYSTEM_PROMPT } from "../prompts/zora-static-system-prompt";
import type { AgentPermissionIntent, AgentRequest, ModelTuning } from "./types";

const PRODUCTIVITY_MODEL: ModelTuning = {
  maxOutputTokens: 64_000,
  reasoningLevel: "high",
};

const PRODUCTIVITY_BUDGET = {
  maxTurns: 500,
} as const;

interface ProductivityProfileDependencies {
  loadConversation: typeof loadMessages;
  buildDynamicContext: typeof buildZoraDynamicContext;
}

export interface ProductivityProfileInput {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  cwd: string;
  permissionMode: AgentPermissionIntent;
  modelOverrides?: Partial<ModelTuning>;
}

export interface ProductivityHarnessState {
  messages: AgentRequest["conversation"]["messages"];
  dynamicContext: string;
  persistence?: AgentRequest["conversation"]["persistence"];
  maxTurns?: number;
  output?: AgentRequest["output"];
}

export function createProductivityHarness(
  input: ProductivityProfileInput,
  state: ProductivityHarnessState
): AgentRequest {
  return {
    profileId: "productivity",
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    prompt: {
      user: input.prompt,
      dynamicContext: state.dynamicContext,
      system: ZORA_STATIC_SYSTEM_PROMPT,
    },
    conversation: {
      messages: state.messages,
      persistence: state.persistence ?? "durable",
    },
    workspace: { cwd: input.cwd },
    permissions: {
      mode: input.permissionMode,
    },
    model: {
      ...PRODUCTIVITY_MODEL,
      ...input.modelOverrides,
    },
    budget: { maxTurns: state.maxTurns ?? PRODUCTIVITY_BUDGET.maxTurns },
    output: state.output ?? { incremental: true, visible: true },
  };
}

export class ProductivityProfile {
  constructor(
    private readonly dependencies: ProductivityProfileDependencies = {
      loadConversation: loadMessages,
      buildDynamicContext: buildZoraDynamicContext,
    }
  ) {}

  async prepare(input: ProductivityProfileInput): Promise<AgentRequest> {
    const [messages, dynamicContext] = await Promise.all([
      this.dependencies.loadConversation(input.sessionId, input.workspaceId),
      this.dependencies.buildDynamicContext(input.workspaceId, input.cwd),
    ]);

    return createProductivityHarness(input, { messages, dynamicContext });
  }
}
