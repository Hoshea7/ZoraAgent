import { randomUUID } from "node:crypto";
import type {
  AgentStreamEvent,
  FileAttachment,
  StopCurrentRunResult,
  SubmitUserEditInput,
  SubmitUserEditResult,
  SubmitUserMessageInput,
  SubmitUserMessageResult,
} from "../shared/zora";
import { formatUserCorrection } from "../shared/correction";
import {
  AgentRunStateError,
  agentExecutionService,
} from "./agent-execution-service";
import { memoryAgent } from "./memory-agent";
import { runSessionCommand } from "./session-command-gate";
import { revisePromptInSession, runPromptInSession } from "./session-runner";
import {
  appendMessageRecord,
  loadMessages,
  projectSavedAttachments,
  saveAttachments,
} from "./session-store";

type ForwardEvent = (event: AgentStreamEvent) => void;

export interface SessionInteractionDependencies {
  forwardEvent: (sessionId: string, event: AgentStreamEvent) => void;
}

export class SessionInteraction {
  constructor(private readonly dependencies: SessionInteractionDependencies) {}

  async submitUserMessage(
    input: SubmitUserMessageInput
  ): Promise<SubmitUserMessageResult> {
    const sessionId = input.sessionId.trim();
    const workspaceId = input.workspaceId?.trim() || "default";
    const messageId = input.messageId.trim();
    const text = input.text.trim();
    if (!sessionId) throw new Error("A valid sessionId is required.");
    if (!messageId) throw new Error("A valid messageId is required.");
    if (!text) throw new Error("A non-empty prompt is required.");

    return runSessionCommand(sessionId, workspaceId, async () => {
      const runInfo = agentExecutionService.getRunInfo(sessionId);
      if (!runInfo.running || !runInfo.runId || !runInfo.source) {
        const runId = randomUUID();
        await runPromptInSession({
          sessionId,
          runId,
          workspaceId,
          text,
          attachments: input.attachments,
          userMessageId: messageId,
          source: "desktop",
          forwardEvent: this.forwardEvent(sessionId),
        });
        return { mode: "started", runId, source: "desktop" };
      }

      const persisted = await this.persistQueuedMessage({
        sessionId,
        workspaceId,
        messageId,
        text,
        attachments: input.attachments,
      });
      try {
        await agentExecutionService.enqueue(sessionId, runInfo.runId, {
          id: messageId,
          text,
          attachments: persisted.runtimeAttachments,
        });
        if (runInfo.source !== "delegation") {
          memoryAgent.scheduleProcessing(sessionId, workspaceId);
        }
        this.emitCommittedMessage(sessionId, runInfo.runId, persisted.message);
        return {
          mode: "enqueued",
          runId: runInfo.runId,
          source: runInfo.source,
        };
      } catch (error) {
        if (!(error instanceof AgentRunStateError) || error.code === "stopped") {
          throw error;
        }
        const current = agentExecutionService.getRunInfo(sessionId);
        if (current.running && current.runId && current.source) {
          await agentExecutionService.enqueue(sessionId, current.runId, {
            id: messageId,
            text,
            attachments: persisted.runtimeAttachments,
          });
          if (current.source !== "delegation") {
            memoryAgent.scheduleProcessing(sessionId, workspaceId);
          }
          this.emitCommittedMessage(sessionId, current.runId, persisted.message);
          return {
            mode: "enqueued",
            runId: current.runId,
            source: current.source,
          };
        }
        const runId = randomUUID();
        await runPromptInSession({
          sessionId,
          runId,
          workspaceId,
          text,
          attachments: persisted.runtimeAttachments,
          messageAlreadyPersisted: true,
          userMessageId: messageId,
          source: "desktop",
          forwardEvent: this.forwardEvent(sessionId),
        });
        return { mode: "started", runId, source: "desktop" };
      }
    });
  }

  async stopCurrentRun(
    sessionId: string,
    expectedRunId: string
  ): Promise<StopCurrentRunResult> {
    const normalizedSessionId = sessionId.trim();
    const normalizedRunId = expectedRunId.trim();
    if (!normalizedSessionId || !normalizedRunId) {
      throw new Error("A sessionId and expectedRunId are required.");
    }
    const result = await agentExecutionService.stop(
      normalizedSessionId,
      normalizedRunId
    );
    if (result === "not_running") return { mode: "not_running" };
    if (result === "state_changed") {
      const activeRunId = agentExecutionService.getRunInfo(normalizedSessionId).runId;
      return activeRunId
        ? { mode: "state_changed", activeRunId }
        : { mode: "not_running" };
    }
    return { mode: "stopped", runId: normalizedRunId };
  }

  async submitUserEdit(input: SubmitUserEditInput): Promise<SubmitUserEditResult> {
    const sessionId = input.sessionId.trim();
    const workspaceId = input.workspaceId?.trim() || "default";
    const targetMessageId = input.targetMessageId.trim();
    const revisedText = input.text.trim();
    const observedRunId = input.observedRunId?.trim();
    if (!sessionId) throw new Error("A valid sessionId is required.");
    if (!targetMessageId) throw new Error("A valid targetMessageId is required.");
    if (!revisedText) throw new Error("A non-empty revised message is required.");
    if (
      input.intent !== "correct_active_run" &&
      input.intent !== "revise_history"
    ) {
      throw new Error("A valid edit intent is required.");
    }
    if (input.intent === "correct_active_run" && !observedRunId) {
      throw new Error("correct_active_run requires observedRunId.");
    }

    return runSessionCommand(sessionId, workspaceId, async () => {
      const runInfo = agentExecutionService.getRunInfo(sessionId);
      if (input.intent === "revise_history") {
        if (runInfo.running) {
          return { mode: "state_changed", activeRunId: runInfo.runId };
        }
        const runId = randomUUID();
        const session = await revisePromptInSession({
          sessionId,
          runId,
          workspaceId,
          messageId: targetMessageId,
          text: revisedText,
          forwardEvent: this.forwardEvent(sessionId),
        });
        return { mode: "revised", runId, session };
      }

      if (runInfo.running && runInfo.runId !== observedRunId) {
        return { mode: "state_changed", activeRunId: runInfo.runId };
      }

      const messages = await loadMessages(sessionId, workspaceId);
      const target = messages.find(
        (message) => message.role === "user" && message.id === targetMessageId
      );
      if (!target) {
        throw new Error(`Message ${targetMessageId} not found in session ${sessionId}.`);
      }
      const correctionText = formatUserCorrection(target.text ?? "", revisedText);
      const correctionMessageId = `user-${randomUUID()}`;

      if (runInfo.running && runInfo.runId === observedRunId) {
        try {
          await agentExecutionService.enqueue(sessionId, observedRunId!, {
            id: correctionMessageId,
            text: correctionText,
          });
        } catch (error) {
          if (!(error instanceof AgentRunStateError)) throw error;
          const current = agentExecutionService.getRunInfo(sessionId);
          if (current.running) {
            return { mode: "state_changed", activeRunId: current.runId };
          }
          return this.startCorrectionRun({
            sessionId,
            workspaceId,
            targetMessageId,
            correctionMessageId,
            correctionText,
          });
        }
        const correctionMessage = await this.persistCorrection({
          sessionId,
          workspaceId,
          targetMessageId,
          correctionMessageId,
          correctionText,
        });
        if (runInfo.source !== "delegation") {
          memoryAgent.scheduleProcessing(sessionId, workspaceId);
        }
        this.emitCommittedMessage(
          sessionId,
          observedRunId!,
          correctionMessage
        );
        return {
          mode: "steered",
          runId: observedRunId!,
          correctionMessageId,
        };
      }

      return this.startCorrectionRun({
        sessionId,
        workspaceId,
        targetMessageId,
        correctionMessageId,
        correctionText,
      });
    });
  }

  private forwardEvent(sessionId: string): ForwardEvent {
    return (event) => this.dependencies.forwardEvent(sessionId, event);
  }

  private emitCommittedMessage(
    sessionId: string,
    runId: string,
    message: Extract<AgentStreamEvent, { type: "user_message_committed" }>["message"]
  ): void {
    this.dependencies.forwardEvent(sessionId, {
      type: "user_message_committed",
      sessionId,
      runId,
      message: {
        ...message,
        queueState: "pending",
        queueUuid: message.id,
      },
    });
  }

  private async persistQueuedMessage(input: {
    sessionId: string;
    workspaceId: string;
    messageId: string;
    text: string;
    attachments?: FileAttachment[];
  }): Promise<{
    runtimeAttachments?: FileAttachment[];
    message: Extract<AgentStreamEvent, { type: "user_message_committed" }>["message"];
  }> {
    const savedAttachments = input.attachments?.length
      ? await saveAttachments(input.sessionId, input.attachments, input.workspaceId)
      : [];
    const runtimeAttachments = savedAttachments.length
      ? await projectSavedAttachments(
          input.sessionId,
          savedAttachments,
          input.workspaceId
        )
      : undefined;
    const persistedMessage = {
      id: input.messageId,
      role: "user" as const,
      text: input.text,
      timestamp: Date.now(),
      attachments: savedAttachments.length ? savedAttachments : undefined,
    };
    await appendMessageRecord(
      input.sessionId,
      {
        kind: "user",
        message: persistedMessage,
      },
      input.workspaceId
    );
    return {
      runtimeAttachments,
      message: {
        ...persistedMessage,
        attachments: input.attachments?.length ? input.attachments : undefined,
      },
    };
  }

  private async persistCorrection(input: {
    sessionId: string;
    workspaceId: string;
    targetMessageId: string;
    correctionMessageId: string;
    correctionText: string;
  }): Promise<Extract<AgentStreamEvent, { type: "user_message_committed" }>["message"]> {
    const message = {
      id: input.correctionMessageId,
      role: "user" as const,
      text: input.correctionText,
      timestamp: Date.now(),
      correction: { targetMessageId: input.targetMessageId },
    };
    await appendMessageRecord(
      input.sessionId,
      {
        kind: "user",
        message,
      },
      input.workspaceId
    );
    return message;
  }

  private async startCorrectionRun(input: {
    sessionId: string;
    workspaceId: string;
    targetMessageId: string;
    correctionMessageId: string;
    correctionText: string;
  }): Promise<SubmitUserEditResult> {
    await this.persistCorrection(input);
    const runId = randomUUID();
    await runPromptInSession({
      sessionId: input.sessionId,
      runId,
      workspaceId: input.workspaceId,
      text: input.correctionText,
      messageAlreadyPersisted: true,
      userMessageId: input.correctionMessageId,
      source: "desktop",
      forwardEvent: this.forwardEvent(input.sessionId),
    });
    return {
      mode: "started_correction",
      runId,
      correctionMessageId: input.correctionMessageId,
    };
  }
}
