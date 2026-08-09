import { randomUUID } from "node:crypto";
import type {
  ConversationMessage,
  SessionMeta,
  SessionForkRequest,
  SessionForkResult,
} from "../shared/zora";
import {
  copyClaudeSdkTranscriptToProject,
  readAssistantForkIdMap,
} from "./claude-transcript";
import { normalizeOptionalString } from "./utils/validate";
import { DEFAULT_AGENT_RUNTIME } from "./runtime/types";
import {
  copySessionWorkingDirectory,
  createForkedSession,
  createSessionWorkingDirectory,
  deleteManagedSessionWorkingDirectory,
  flushSessionWrites,
  getSessionMeta,
  getSessionWorkingDirectory,
  loadMessages,
} from "./session-store";

export interface ForkSessionFromSourceInput extends SessionForkRequest {
  workspaceId: string;
}

function composeAssistantTurnIdMap(
  sourceAssistantTurnIdMap: ReadonlyMap<string, string>,
  forkAssistantTurnIdMap: ReadonlyMap<string, string>
): Map<string, string> {
  const composed = new Map(forkAssistantTurnIdMap);

  for (const [sourceMessageId, currentMessageId] of sourceAssistantTurnIdMap) {
    const forkedMessageId = forkAssistantTurnIdMap.get(currentMessageId);
    if (forkedMessageId && forkedMessageId !== sourceMessageId) {
      composed.set(sourceMessageId, forkedMessageId);
    }
  }

  return composed;
}

export async function forkSessionFromSource(
  input: ForkSessionFromSourceInput
): Promise<SessionForkResult> {
  const source = await getSessionMeta(input.sourceSessionId, input.workspaceId);

  if (!source) {
    throw new Error(`Session ${input.sourceSessionId} not found.`);
  }

  const runtimeType = source.agentRuntimeType
    ?? (source.sdkSessionId ? "claude" : DEFAULT_AGENT_RUNTIME);
  if (runtimeType === "pi") {
    return forkPiSession(input, source);
  }
  return forkClaudeSession(input, source);
}

async function forkPiSession(
  input: ForkSessionFromSourceInput,
  source: SessionMeta
): Promise<SessionForkResult> {
  const targetSessionId = randomUUID();
  const targetWorkingDirectory = await createSessionWorkingDirectory(
    targetSessionId,
    input.workspaceId
  );
  const workingDirectoryOwnerId = source.workingDirectoryOwnerSessionId ?? source.id;
  const sourceWorkingDirectory = await getSessionWorkingDirectory(
    workingDirectoryOwnerId,
    input.workspaceId
  );
  const title = normalizeOptionalString(input.title) ?? source.title;
  const requestedUpToMessageId =
    normalizeOptionalString(input.upToMessageId) ?? undefined;

  try {
    await flushSessionWrites(source.id, input.workspaceId);
    await copySessionWorkingDirectory(
      workingDirectoryOwnerId,
      targetSessionId,
      input.workspaceId,
      sourceWorkingDirectory
    );
  } catch (error) {
    await deleteManagedSessionWorkingDirectory(
      targetSessionId,
      input.workspaceId,
      targetWorkingDirectory
    );
    throw error;
  }

  const session = await createForkedSession(
    {
      id: targetSessionId,
      sourceSessionId: source.id,
      agentRuntimeType: "pi",
      title,
      workingDirectory: targetWorkingDirectory,
      upToMessageId: requestedUpToMessageId,
    },
    input.workspaceId
  );
  const messages: ConversationMessage[] = await loadMessages(
    session.id,
    input.workspaceId
  );

  return { session, messages };
}

async function forkClaudeSession(
  input: ForkSessionFromSourceInput,
  source: SessionMeta
): Promise<SessionForkResult> {
  if (!source.sdkSessionId) {
    throw new Error(
      "当前会话还没有可分叉的 Claude SDK 上下文。请先在该会话里发送一条消息后再试。"
    );
  }

  const targetSessionId = randomUUID();
  const targetWorkingDirectory = await createSessionWorkingDirectory(
    targetSessionId,
    input.workspaceId
  );
  const workingDirectoryOwnerId = source.workingDirectoryOwnerSessionId ?? source.id;
  const sourceWorkingDirectory = await getSessionWorkingDirectory(
    workingDirectoryOwnerId,
    input.workspaceId
  );
  const title = normalizeOptionalString(input.title) ?? source.title;
  const requestedUpToMessageId =
    normalizeOptionalString(input.upToMessageId) ?? undefined;
  const { forkSession: forkSdkSession } = await import(
    "@anthropic-ai/claude-agent-sdk"
  );
  let forkedSdkSessionId = "";
  let sourceTranscriptUpToMessageId = requestedUpToMessageId;
  let assistantTurnIdMap = new Map<string, string>();

  try {
    await flushSessionWrites(source.id, input.workspaceId);
    const sourceAssistantTurnIdMap = await readAssistantForkIdMap({
      sdkSessionId: source.sdkSessionId,
      workingDirectory: sourceWorkingDirectory,
    });

    if (
      requestedUpToMessageId &&
      sourceAssistantTurnIdMap.has(requestedUpToMessageId)
    ) {
      sourceTranscriptUpToMessageId =
        sourceAssistantTurnIdMap.get(requestedUpToMessageId);
    }

    await copySessionWorkingDirectory(
      workingDirectoryOwnerId,
      targetSessionId,
      input.workspaceId,
      sourceWorkingDirectory
    );
    const sdkFork = await forkSdkSession(source.sdkSessionId, {
      dir: sourceWorkingDirectory,
      title,
      upToMessageId: sourceTranscriptUpToMessageId,
    });

    if (!sdkFork.sessionId) {
      throw new Error("Claude Agent SDK did not return a forked session id.");
    }

    forkedSdkSessionId = sdkFork.sessionId;
    const [forkAssistantTurnIdMap] = await Promise.all([
      readAssistantForkIdMap({
        sdkSessionId: forkedSdkSessionId,
        workingDirectory: sourceWorkingDirectory,
      }),
      copyClaudeSdkTranscriptToProject({
        sdkSessionId: forkedSdkSessionId,
        sourceWorkingDirectory,
        targetWorkingDirectory,
      }),
    ]);
    assistantTurnIdMap = composeAssistantTurnIdMap(
      sourceAssistantTurnIdMap,
      forkAssistantTurnIdMap
    );
  } catch (error) {
    await deleteManagedSessionWorkingDirectory(
      targetSessionId,
      input.workspaceId,
      targetWorkingDirectory
    );
    throw error;
  }

  const session = await createForkedSession(
    {
      id: targetSessionId,
      sourceSessionId: source.id,
      sourceSdkSessionId: source.sdkSessionId,
      sdkSessionId: forkedSdkSessionId,
      agentRuntimeType: "claude",
      title,
      workingDirectory: targetWorkingDirectory,
      upToMessageId: requestedUpToMessageId,
      transcriptCopyOptions: {
        assistantTurnIdRewrites: assistantTurnIdMap,
      },
    },
    input.workspaceId
  );
  const messages: ConversationMessage[] = await loadMessages(
    session.id,
    input.workspaceId
  );

  return { session, messages };
}
