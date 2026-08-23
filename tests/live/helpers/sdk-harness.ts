import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildProviderSdkEnv } from "@/main/provider-manager";
import {
  getSDKRuntimeOptions,
} from "@/main/sdk-runtime";
import type { TestProviderConfig } from "./resolve-test-provider";
import { createLiveTestSandbox } from "./live-test-sandbox";

export interface LiveCallResult {
  success: boolean;
  text: string;
  messages: SDKMessage[];
  error?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractAssistantText(message: SDKMessage): string {
  if (message.type !== "assistant" || !isRecord(message.message)) {
    return "";
  }

  const content = message.message.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (!isRecord(block)) {
        return "";
      }

      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractTextDelta(message: SDKMessage): string {
  if (message.type === "assistant") {
    return extractAssistantText(message);
  }

  if (message.type !== "stream_event" || !isRecord(message.event)) {
    return "";
  }

  if (message.event.type !== "content_block_delta" || !isRecord(message.event.delta)) {
    return "";
  }

  return message.event.delta.type === "text_delta" &&
    typeof message.event.delta.text === "string"
    ? message.event.delta.text
    : "";
}

function extractErrorMessage(message: SDKMessage): string | null {
  if (message.type !== "result" || message.is_error !== true) {
    return null;
  }

  if (Array.isArray(message.errors) && message.errors.length > 0) {
    return message.errors.join(" | ");
  }

  if (typeof message.result === "string" && message.result.trim().length > 0) {
    return message.result;
  }

  return `SDK request failed (${message.subtype})`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : String(error);
}

export async function sendLiveQuery(
  provider: TestProviderConfig,
  prompt: string,
  options?: {
    maxTurns?: number;
    abortController?: AbortController;
    cwd?: string;
    systemPromptAppend?: string;
    systemPrompt?: string;
  }
): Promise<LiveCallResult> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const runtime = getSDKRuntimeOptions();
  const systemPromptAppend = options?.systemPrompt ?? options?.systemPromptAppend;
  const sandbox = await createLiveTestSandbox();
  const messages: SDKMessage[] = [];
  let text = "";
  let response: ReturnType<typeof query> | null = null;

  try {
    response = query({
      prompt,
      options: {
        cwd: options?.cwd ?? sandbox.workspaceDir,
        pathToClaudeCodeExecutable: runtime.pathToClaudeCodeExecutable,
        executable: runtime.executable,
        executableArgs: runtime.executableArgs,
        maxTurns: options?.maxTurns ?? 1,
        persistSession: false,
        includePartialMessages: false,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        env: {
          ...buildProviderSdkEnv({
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            modelId: provider.model,
          }),
          ...runtime.env,
          ...sandbox.environment,
        },
        ...(systemPromptAppend
          ? {
              systemPrompt: {
                type: "preset" as const,
                preset: "claude_code" as const,
                append: systemPromptAppend,
              },
            }
          : {}),
        ...(options?.abortController ? { abortController: options.abortController } : {}),
      },
    });

    for await (const sdkMessage of response) {
      messages.push(sdkMessage);

      const errorMessage = extractErrorMessage(sdkMessage);
      if (errorMessage) {
        return {
          success: false,
          text: text.trim(),
          messages,
          error: errorMessage,
        };
      }

      const chunk = extractTextDelta(sdkMessage);
      if (chunk.length > 0) {
        text = sdkMessage.type === "assistant" ? chunk : `${text}${chunk}`;
      }
    }

    return {
      success: true,
      text: text.trim(),
      messages,
    };
  } catch (error) {
    return {
      success: false,
      text: text.trim(),
      messages,
      error: toErrorMessage(error),
    };
  } finally {
    response?.close();
    await sandbox.cleanup();
  }
}

/**
 * 携带对话历史发起 SDK 调用。
 * 历史消息通过 prompt 拼接注入，模拟 session 恢复后的续聊场景。
 */
export async function sendLiveConversation(
  provider: TestProviderConfig,
  history: ConversationMessage[],
  newUserMessage: string,
  options?: {
    systemPrompt?: string;
    maxTurns?: number;
    cwd?: string;
  }
): Promise<LiveCallResult> {
  const historyBlock = history
    .map((message) => {
      const prefix = message.role === "user" ? "User" : "Assistant";
      return `${prefix}: ${message.content}`;
    })
    .join("\n\n");

  const contextualPrompt = [
    ...(options?.systemPrompt ? [options.systemPrompt, ""] : []),
    ...(history.length > 0
      ? [
          "Here is our conversation so far:",
          "",
          historyBlock,
          "",
          "Continue the conversation. The user says:",
          "",
        ]
      : []),
    `User: ${newUserMessage}`,
    "",
    "Respond as the assistant only.",
  ].join("\n");

  return sendLiveQuery(provider, contextualPrompt, {
    maxTurns: options?.maxTurns ?? 1,
    cwd: options?.cwd,
    ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
  });
}
