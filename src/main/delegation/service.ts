import type { AgentStreamEvent } from "../../shared/zora";
import { agentExecutionService } from "../agent-execution-service";
import { answerAskUserQuestion, respondToPermission } from "../hitl";
import { runPromptInSession } from "../session-runner";
import { DelegationCoordinator } from "./coordinator";
import { resolveDelegationRuntimeTarget } from "./provider-selection";

let emitEvent: (event: AgentStreamEvent) => void = () => undefined;

export const delegationCoordinator = new DelegationCoordinator({
  execute: async (input) => {
    const result = await runPromptInSession({
      sessionId: input.childSession.id,
      runId: input.childSession.delegationRunId,
      workspaceId: input.workspaceId,
      text: input.prompt,
      source: "delegation",
      permissionMode: "interactive",
      waitForCompletion: true,
      userMessageId: input.userMessageId,
      onRunStarted: input.onRunStarted,
      forwardEvent: (event) => {
        delegationCoordinator.observeChildEvent(input.childSession.id, event);
        emitEvent({ ...event, sessionId: input.childSession.id });
      },
    });
    if (!result) {
      return { status: "failed", error: "Delegation execution did not return a result." };
    }
    return result;
  },
  emit: (event) => emitEvent(event),
  stop: (sessionId, expectedRunId) =>
    agentExecutionService.stop(sessionId, expectedRunId),
  getRunInfo: (sessionId) => agentExecutionService.getRunInfo(sessionId),
  respondPermission: respondToPermission,
  answerQuestion: answerAskUserQuestion,
  resolveRuntimeTarget: resolveDelegationRuntimeTarget,
});

export function setDelegationEventEmitter(
  emitter: (event: AgentStreamEvent) => void
): void {
  emitEvent = emitter;
}
