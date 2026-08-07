import type { AskUserQuestion as AskUserQuestionSpec } from "../../shared/zora";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseQuestionOptions(
  value: unknown
): AskUserQuestionSpec["options"] {
  if (!Array.isArray(value)) return undefined;

  const options = value.flatMap((option) => {
    if (!isRecord(option) || typeof option.label !== "string") return [];
    return [{
      label: option.label,
      description:
        typeof option.description === "string" ? option.description : undefined,
    }];
  });
  return options.length > 0 ? options : undefined;
}

export function parseAskUserQuestionSpecs(
  input: Record<string, unknown>
): AskUserQuestionSpec[] {
  if (Array.isArray(input.questions)) {
    return input.questions.flatMap((candidate) => {
      if (typeof candidate === "string") {
        return [{ question: candidate }];
      }
      if (!isRecord(candidate) || typeof candidate.question !== "string") {
        return [];
      }
      return [{
        question: candidate.question,
        options: parseQuestionOptions(candidate.options),
      }];
    });
  }

  if (typeof input.question === "string") {
    return [{
      question: input.question,
      options: parseQuestionOptions(input.options),
    }];
  }

  return [];
}

export interface ToolAuthorizationRequest {
  tool: string;
  input: Record<string, unknown>;
  callId: string;
  signal: AbortSignal;
  agentId?: string;
}

export type ToolAuthorizationDecision =
  | { behavior: "allow"; input?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export interface AskUserQuestionRequest {
  questions: AskUserQuestionSpec[];
  callId: string;
  signal: AbortSignal;
}

export interface ToolGate {
  authorize(
    req: ToolAuthorizationRequest
  ): Promise<ToolAuthorizationDecision>;
  ask(req: AskUserQuestionRequest): Promise<Record<string, string>>;
}

/**
 * 无人值守场景的显式放行 Gate。
 *
 * 后台运行（记忆整理、飞书触发等）没有可审批的用户，必须放行。用具名 Gate 表达
 * 这个意图，而不是让「没有 Gate」隐式等于放行：后者会让接线 bug 静默退化成无授权
 * 执行，而这正是历史上删掉授权却没有测试变红的那类故障。
 */
export function createUnattendedToolGate(): ToolGate {
  return {
    authorize: async () => ({ behavior: "allow" }),
    ask: async () => {
      throw new Error("无人值守运行中无法向用户提问。");
    },
  };
}

interface ExecutableTool {
  name: string;
  execute: (...args: any[]) => Promise<unknown>;
}

interface ToolGateWrapperOptions {
  canonicalizeToolName?: (toolName: string) => string;
  normalizeInput?: (
    toolName: string,
    input: Record<string, unknown>
  ) => Record<string, unknown>;
  agentId?: string;
}

export function authorizeTools<T extends ExecutableTool>(
  tools: readonly T[],
  gate: ToolGate,
  options: ToolGateWrapperOptions = {}
): T[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (
      callId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      ...rest: unknown[]
    ) => {
      const effectiveSignal = signal ?? new AbortController().signal;
      const rawInput = params ?? {};
      const input = options.normalizeInput?.(tool.name, rawInput) ?? rawInput;
      const decision = await gate.authorize({
        tool: options.canonicalizeToolName?.(tool.name) ?? tool.name,
        input,
        callId,
        signal: effectiveSignal,
        agentId: options.agentId,
      });

      if (decision.behavior === "deny") {
        throw new Error(decision.message);
      }

      return tool.execute(
        callId,
        decision.input ?? rawInput,
        signal,
        ...rest
      );
    },
  })) as T[];
}
