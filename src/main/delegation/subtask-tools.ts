import { z } from "zod";
import type { AgentRuntimeType } from "../../shared/zora";
import type {
  ProvisionedTool,
  ProvisionedToolExecutionContext,
  ProvisionedToolResult,
} from "../runtime/tool-provisioning";
import type { ScopedDelegationCoordinator } from "./coordinator";
import { listAvailableSubtaskModels } from "./provider-selection";

const delegateSchema = z
  .object({
    task: z.string().trim().min(1).max(20_000),
    title: z.string().trim().min(1).max(80).optional(),
    role: z.enum(["explore", "review"]),
    expectedOutput: z.string().trim().min(1).max(4_000).optional(),
    providerId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Exact providerId copied from list_available_models. Do not pass providerName."
      ),
    modelId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Exact modelId paired with providerId in list_available_models."
      ),
    agentRuntimeType: z.enum(["claude", "pi"]).optional(),
    permissionMode: z.enum(["ask", "smart", "yolo"]).optional(),
  })
  .strict();

const waitSchema = z
  .object({
    delegationIds: z.array(z.string().uuid()).min(1).max(20),
    mode: z.enum(["all", "any"]).optional(),
    minSettled: z.number().int().min(1).max(20).optional(),
    timeoutSeconds: z.number().int().min(1).max(45).optional(),
  })
  .strict();

const delegateManySchema = z
  .object({
    sharedContext: z.string().trim().min(1).max(20_000).optional(),
    tasks: z.array(delegateSchema).min(1).max(10),
  })
  .strict();

const idsSchema = z
  .object({ delegationIds: z.array(z.string().uuid()).min(1).max(20) })
  .strict();

const stopSchema = z
  .object({ delegationId: z.string().uuid(), expectedRunId: z.string().uuid() })
  .strict();

const respondSchema = z
  .object({
    delegationId: z.string().uuid(),
    blockedEventId: z.string().min(1),
    response: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("permission"),
        behavior: z.enum(["allow", "deny"]),
        alwaysAllow: z.boolean().optional(),
        userMessage: z.string().max(2_000).optional(),
      }).strict(),
      z.object({
        type: z.literal("ask_user"),
        answers: z.record(z.string(), z.string()).refine(
          (answers) =>
            Object.values(answers).reduce((total, answer) => total + answer.length, 0) <= 10_000,
          "answers exceed the 10,000 character limit"
        ),
      }).strict(),
    ]),
  })
  .strict();

const continueSchema = z
  .object({
    delegationId: z.string().uuid(),
    expectedRunId: z.string().uuid(),
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();

function jsonResult(value: unknown): ProvisionedToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function requireInvocation(context: ProvisionedToolExecutionContext): string {
  if (!context.invocationId) {
    throw new Error("This tool requires a stable runtime invocation ID.");
  }
  return context.invocationId;
}

function tool(
  input: Omit<ProvisionedTool, "canonicalName" | "serverName">
): ProvisionedTool {
  return {
    ...input,
    serverName: "subtask",
    canonicalName: `mcp__subtask__${input.toolName}`,
  };
}

export function createSubtaskProvisionedTools(
  coordinator: ScopedDelegationCoordinator,
  target: { runtime: AgentRuntimeType; providerId: string; modelId: string }
): ProvisionedTool[] {
  return [
    tool({
      toolName: "list_available_models",
      label: "List Available Models",
      description: "List enabled Provider and model candidates that can run a child task.",
      inputSchema: {},
      approvalPolicy: "auto",
      execute: async () =>
        jsonResult(
          await listAvailableSubtaskModels({
            currentProviderId: target.providerId,
            currentModelId: target.modelId,
            preferredRuntime: target.runtime,
          })
        ),
    }),
    tool({
      toolName: "delegate_agents",
      label: "Delegate Agents",
      description:
        "Create between one and ten independent child agents in parallel. When selecting another Provider or model, call list_available_models first and copy the exact providerId/modelId pair; never use providerName as providerId.",
      inputSchema: delegateManySchema.shape,
      approvalPolicy: "auto",
      execute: async (raw, context) =>
        jsonResult(
          await coordinator.startMany(delegateManySchema.parse(raw), {
            invocationId: requireInvocation(context),
            runtime: target.runtime,
            providerId: target.providerId,
            modelId: target.modelId,
          })
        ),
    }),
    tool({
      toolName: "delegate_agent",
      label: "Delegate Agent",
      description:
        "Create one visible child agent for exploration or review. The child inherits the parent permission mode unless a stricter mode is requested. When selecting another Provider or model, call list_available_models first and copy the exact providerId/modelId pair; never use providerName as providerId.",
      inputSchema: delegateSchema.shape,
      approvalPolicy: "auto",
      execute: async (raw, context) =>
        jsonResult(
          await coordinator.start(delegateSchema.parse(raw), {
            invocationId: requireInvocation(context),
            runtime: target.runtime,
            providerId: target.providerId,
            modelId: target.modelId,
          })
        ),
    }),
    tool({
      toolName: "wait_for_delegations",
      label: "Wait For Delegations",
      description:
        "Wait for explicit child delegation IDs to settle, require an answer, or reach the timeout, returning resultSummary for completed children. Child permission requests suspend this call until the user resolves them.",
      inputSchema: waitSchema.shape,
      approvalPolicy: "auto",
      execute: async (raw, context) =>
        jsonResult(await coordinator.wait(waitSchema.parse(raw), context.signal)),
    }),
    tool({
      toolName: "list_delegations",
      label: "List Delegations",
      description: "List every child delegation in the current parent-session scope.",
      inputSchema: {},
      approvalPolicy: "auto",
      execute: async () => jsonResult(await coordinator.list()),
    }),
    tool({
      toolName: "get_delegation_results",
      label: "Get Delegation Results",
      description:
        "Read the final resultSummary for explicit child delegation IDs. Each result includes up to 50,000 characters plus an explicit truncation notice when needed.",
      inputSchema: idsSchema.shape,
      approvalPolicy: "auto",
      execute: async (raw) => {
        const args = idsSchema.parse(raw);
        return jsonResult(await coordinator.getResults(args.delegationIds));
      },
    }),
    tool({
      toolName: "respond_to_delegation",
      label: "Respond To Delegation",
      description: "Answer one blocked permission or user question from a child delegation.",
      inputSchema: respondSchema.shape,
      approvalPolicy: "ask",
      execute: async (raw, context) => {
        requireInvocation(context);
        const args = respondSchema.parse(raw);
        return jsonResult(
          await coordinator.respond(
            args.delegationId,
            args.blockedEventId,
            args.response
          )
        );
      },
    }),
    tool({
      toolName: "continue_delegation",
      label: "Continue Delegation",
      description: "Start a new turn in a completed or stopped child session while preserving its history.",
      inputSchema: continueSchema.shape,
      approvalPolicy: "auto",
      execute: async (raw, context) => {
        const args = continueSchema.parse(raw);
        return jsonResult(
          await coordinator.continueDelegation(
            args.delegationId,
            args.expectedRunId,
            args.message,
            {
              invocationId: requireInvocation(context),
              runtime: target.runtime,
              providerId: target.providerId,
              modelId: target.modelId,
            }
          )
        );
      },
    }),
    tool({
      toolName: "stop_delegation",
      label: "Stop Delegation",
      description: "Stop a running child delegation after checking its current run ID.",
      inputSchema: stopSchema.shape,
      approvalPolicy: "auto",
      execute: async (raw, context) => {
        requireInvocation(context);
        const args = stopSchema.parse(raw);
        return jsonResult(
          await coordinator.stop(args.delegationId, args.expectedRunId)
        );
      },
    }),
  ];
}
