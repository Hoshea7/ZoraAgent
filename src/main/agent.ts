import { app } from "electron";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { AgentStatus, AgentStreamEvent } from "../shared/zora";
import { clearAllPending } from "./hitl";
import { ensureZoraDir } from "./memory-store";
import type { QueryProfile } from "./query-profiles/types";
import { setSessionId } from "./session-manager";
import { setSdkSessionId } from "./session-store";

type JsonRecord = Record<string, unknown>;
export type AgentEventForwarder = (event: AgentStreamEvent) => void;

type ActiveAgentRun = {
  query: {
    interrupt: () => Promise<void>;
    close: () => void;
  };
  stopping: boolean;
};

const activeAgentRuns = new Map<string, ActiveAgentRun>();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractAssistantContent(message: unknown): string {
  if (!isRecord(message)) {
    return stringifyContent(message);
  }

  const content = message.content;
  if (!Array.isArray(content)) {
    return stringifyContent(message);
  }

  return content
    .map((block) => {
      if (!isRecord(block)) {
        return stringifyContent(block);
      }

      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }

      return stringifyContent(block);
    })
    .filter(Boolean)
    .join("\n");
}

function extractStreamContent(event: unknown): string {
  if (!isRecord(event)) {
    return stringifyContent(event);
  }

  if (event.type === "content_block_delta") {
    const delta = isRecord(event.delta) ? event.delta : undefined;

    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }

    return stringifyContent(delta);
  }

  if (event.type === "content_block_start") {
    return stringifyContent(event.content_block);
  }

  if (event.type === "message_delta") {
    return stringifyContent(event.delta);
  }

  return stringifyContent(event);
}

function emitAgentStatus(status: AgentStatus, onEvent?: AgentEventForwarder) {
  onEvent?.({
    type: "agent_status",
    status
  });
}

function emitAgentError(error: unknown, onEvent?: AgentEventForwarder) {
  const payload = {
    type: "agent_error",
    error: error instanceof Error ? error.message : stringifyContent(error)
  } as const;

  console.error("[agent] Claude Agent SDK chat failed.");
  console.error(error);
  onEvent?.(payload);
}

function logSdkMessage(message: SDKMessage, onEvent?: AgentEventForwarder) {
  onEvent?.(message as AgentStreamEvent);

  if (message.type === "stream_event") {
    const event = message.event;
    const eventType = isRecord(event) && typeof event.type === "string" ? event.type : "unknown";
    const content = extractStreamContent(event);
    console.log(`[agent][stream_event:${eventType}]`, content);
    return;
  }

  if (message.type === "assistant") {
    console.log("[agent][assistant]", extractAssistantContent(message.message));
    return;
  }

  if (message.type === "result") {
    const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";
    const content =
      message.subtype === "success"
        ? message.result
        : Array.isArray(message.errors)
          ? message.errors.join(" | ")
          : stringifyContent(message);

    console.log(`[agent][result:${subtype}]`, content);
    return;
  }

  if (message.type === "system") {
    const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";
    const content =
      subtype === "init" && "model" in message
        ? `session=${stringifyContent(message.session_id)} model=${stringifyContent(message.model)}`
        : stringifyContent(message);

    console.log(`[agent][system:${subtype}]`, content);
    return;
  }

  if (message.type === "auth_status") {
    const output = Array.isArray(message.output) ? message.output.join("\n") : "";
    const error = typeof message.error === "string" ? ` error=${message.error}` : "";
    console.log("[agent][auth_status]", `${output}${error}`.trim());
    return;
  }

  console.log(`[agent][${message.type}]`, stringifyContent(message));
}

export function resolveSDKCliPath(): string {
  let cliPath: string | null = null;

  try {
    const cjsRequire = createRequire(__filename);
    const sdkEntryPath = cjsRequire.resolve("@anthropic-ai/claude-agent-sdk");
    cliPath = join(dirname(sdkEntryPath), "cli.js");
    console.log(`[agent] SDK CLI path (createRequire): ${cliPath}`);
  } catch (error) {
    console.warn("[agent] createRequire failed to resolve SDK CLI path.", error);
  }

  if (!cliPath) {
    try {
      cliPath = join(
        dirname(require.resolve("@anthropic-ai/claude-agent-sdk")),
        "cli.js"
      );
      console.log(`[agent] SDK CLI path (require.resolve): ${cliPath}`);
    } catch (error) {
      console.warn("[agent] require.resolve failed to resolve SDK CLI path.", error);
    }
  }

  if (!cliPath) {
    cliPath = join(
      process.cwd(),
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "cli.js"
    );
    console.log(`[agent] SDK CLI path (fallback): ${cliPath}`);
  }

  if (app.isPackaged && cliPath.includes(".asar")) {
    cliPath = cliPath.replace(/\.asar([/\\])/, ".asar.unpacked$1");
    console.log(`[agent] SDK CLI path (asar.unpacked): ${cliPath}`);
  }

  return cliPath;
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
}

export function isAgentRunningForSession(sessionId: string): boolean {
  return activeAgentRuns.has(sessionId);
}

export async function runAgentWithProfile(
  sessionId: string,
  profile: QueryProfile,
  onEvent: AgentEventForwarder
): Promise<void> {
  if (activeAgentRuns.has(sessionId)) {
    throw new Error(`An agent is already running for session ${sessionId}.`);
  }

  console.log(`[agent] Starting query with profile: ${profile.name}`);
  console.log(`[agent] Current mode: ${profile.name}`);
  console.log(`[agent] Resume session: ${(profile.options as any).resume ?? "(new session)"}`);
  console.log(`[agent] Permission mode: ${(profile.options as any).permissionMode}`);

  await ensureZoraDir();
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const response = query({ prompt: profile.prompt, options: profile.options as any });

  const run: ActiveAgentRun = { query: response, stopping: false };
  activeAgentRuns.set(sessionId, run);
  emitAgentStatus("started", onEvent);

  void (async () => {
    try {
      for await (const message of response) {
        if (message.type === "system" && message.subtype === "init") {
          const sid = message.session_id;
          if (typeof sid === "string" && sid.length > 0) {
            if (sessionId === "__awakening__") {
              setSessionId(profile.name, sid);
            } else {
              void setSdkSessionId(sessionId, sid);
            }
          }
        }

        if (message.type === "result") {
          const sid = message.session_id;
          if (typeof sid === "string" && sid.length > 0) {
            if (sessionId === "__awakening__") {
              setSessionId(profile.name, sid);
            } else {
              void setSdkSessionId(sessionId, sid);
            }
          }
        }

        logSdkMessage(message, onEvent);
      }
      console.log(`[agent] Query finished (profile: ${profile.name})`);
      emitAgentStatus(run.stopping ? "stopped" : "finished", onEvent);
    } catch (error) {
      if (!run.stopping || !isAbortLikeError(error)) {
        emitAgentError(error, onEvent);
      }
      emitAgentStatus(run.stopping ? "stopped" : "finished", onEvent);
    } finally {
      try {
        response.close();
      } catch {
        // Ignore close errors while tearing down a finished or aborted run.
      }
      clearAllPending();
      if (activeAgentRuns.get(sessionId) === run) {
        activeAgentRuns.delete(sessionId);
      }
    }
  })();
}

export async function stopAgentForSession(sessionId: string) {
  const run = activeAgentRuns.get(sessionId);
  if (!run) {
    return;
  }
  run.stopping = true;

  try {
    await run.query.interrupt();
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn(`[agent] Failed to interrupt agent for session ${sessionId}.`, error);
    }
  } finally {
    try {
      run.query.close();
    } catch (error) {
      console.warn(`[agent] Failed to close agent for session ${sessionId}.`, error);
    }
  }
}
