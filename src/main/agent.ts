import { app } from "electron";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentStatus, AgentStreamEvent } from "../shared/zora";

type JsonRecord = Record<string, unknown>;
type AgentEventForwarder = (event: AgentStreamEvent) => void;

type ClaudeAgentChatConfig = {
  cwd: string;
  prompt: string;
  onEvent?: AgentEventForwarder;
};

type ActiveAgentRun = {
  query: {
    interrupt: () => Promise<void>;
    close: () => void;
  };
  stopping: boolean;
};

let activeAgentRun: ActiveAgentRun | null = null;

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

function resolveSDKCliPath(): string {
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

export function isClaudeAgentRunning() {
  return activeAgentRun !== null;
}

export async function runClaudeAgentChat({
  cwd,
  prompt,
  onEvent
}: ClaudeAgentChatConfig) {
  if (activeAgentRun) {
    throw new Error("Claude Agent is already running.");
  }

  console.log("[agent] Starting Claude Agent SDK chat...");

  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const sdkCliPath = resolveSDKCliPath();
  const executable = "node";
  const executableArgs: string[] = [];
  const sdkEnv = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: "zora-agent"
  };

  console.log(`[agent] Using SDK CLI: ${sdkCliPath}`);
  console.log(`[agent] Using runtime: ${executable}`);
  console.log(`[agent] API KEY: api key from ~/.claude global setting`);
  console.log("[agent] Query env:", {
    claudeAgentSdkClientApp: sdkEnv.CLAUDE_AGENT_SDK_CLIENT_APP ?? "(empty)",
    sdkCliPath,
    executable,
    executableArgs
  });

  const response = query({
    prompt,
    options: {
      cwd,
      pathToClaudeCodeExecutable: sdkCliPath,
      executable,
      executableArgs,
      maxTurns: 1,
      persistSession: false,
      includePartialMessages: true,
      allowedTools: [],
      env: sdkEnv
    }
  });

  const run: ActiveAgentRun = {
    query: response,
    stopping: false
  };
  activeAgentRun = run;
  emitAgentStatus("started", onEvent);

  void (async () => {
    try {
      for await (const message of response) {
        logSdkMessage(message, onEvent);
      }

      console.log("[agent] Claude Agent SDK chat finished.");
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

      if (activeAgentRun === run) {
        activeAgentRun = null;
      }
    }
  })();
}

export async function stopClaudeAgentChat() {
  if (!activeAgentRun) {
    return;
  }

  const run = activeAgentRun;
  run.stopping = true;

  try {
    await run.query.interrupt();
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn("[agent] Failed to interrupt Claude Agent SDK chat.", error);
    }
  } finally {
    try {
      run.query.close();
    } catch (error) {
      console.warn("[agent] Failed to close Claude Agent SDK chat.", error);
    }
  }
}
