import { atom } from "jotai";
import type { ChatMessage, ChatMessageStatus } from "../types";
import { createId } from "../utils/message";

// 基础状态 atoms
export const messagesAtom = atom<ChatMessage[]>([]);
export const currentAssistantIdAtom = atom<string | null>(null);
export const isRunningAtom = atom(false);
export const draftAtom = atom("");

// 操作 atoms

/**
 * 开始新对话
 * 创建用户消息和助手消息占位符
 */
export const startConversationAtom = atom(null, (_get, set, prompt: string) => {
  const userId = createId("user");
  const assistantId = createId("assistant");

  set(messagesAtom, (current) => [
    ...current,
    {
      id: userId,
      role: "user",
      text: prompt,
      thinking: "",
      status: "done"
    },
    {
      id: assistantId,
      role: "assistant",
      text: "",
      thinking: "",
      status: "streaming"
    }
  ]);
  set(currentAssistantIdAtom, assistantId);
  set(isRunningAtom, true);
});

/**
 * 追加助手文本内容
 */
export const appendAssistantTextAtom = atom(null, (get, set, chunk: string) => {
  const assistantId = get(currentAssistantIdAtom);
  if (!assistantId || chunk.length === 0) {
    return;
  }

  set(messagesAtom, (current) =>
    current.map((message) =>
      message.id === assistantId
        ? {
            ...message,
            text: `${message.text}${chunk}`,
            status: "streaming"
          }
        : message
    )
  );
});

/**
 * 追加助手思考内容
 */
export const appendAssistantThinkingAtom = atom(null, (get, set, chunk: string) => {
  const assistantId = get(currentAssistantIdAtom);
  if (!assistantId || chunk.length === 0) {
    return;
  }

  set(messagesAtom, (current) =>
    current.map((message) =>
      message.id === assistantId
        ? {
            ...message,
            thinking: `${message.thinking}${chunk}`,
            status: "streaming"
          }
        : message
    )
  );
});

/**
 * 水合助手消息
 * 用于一次性设置完整的文本和思考内容
 */
export const hydrateAssistantAtom = atom(
  null,
  (get, set, payload: { text: string; thinking: string }) => {
    const assistantId = get(currentAssistantIdAtom);
    if (!assistantId) {
      return;
    }

    set(messagesAtom, (current) =>
      current.map((message) => {
        if (message.id !== assistantId) {
          return message;
        }

        return {
          ...message,
          text: message.text || payload.text,
          thinking: message.thinking || payload.thinking
        };
      })
    );
  }
);

/**
 * 完成对话
 * 设置最终状态并清理运行标志
 */
export const completeConversationAtom = atom(
  null,
  (get, set, status: Exclude<ChatMessageStatus, "error">) => {
    const assistantId = get(currentAssistantIdAtom);
    if (assistantId) {
      set(messagesAtom, (current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                status
              }
            : message
        )
      );
    }

    set(currentAssistantIdAtom, null);
    set(isRunningAtom, false);
  }
);

/**
 * 对话失败
 * 设置错误状态和错误消息
 */
export const failConversationAtom = atom(null, (get, set, errorMessage: string) => {
  const assistantId = get(currentAssistantIdAtom);
  if (assistantId) {
    set(messagesAtom, (current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              status: "error",
              error: errorMessage,
              text: message.text || "The agent stopped before returning a final reply."
            }
          : message
      )
    );
  } else {
    set(messagesAtom, (current) => [
      ...current,
      {
        id: createId("assistant"),
        role: "assistant",
        text: "The agent could not start.",
        thinking: "",
        status: "error",
        error: errorMessage
      }
    ]);
  }

  set(currentAssistantIdAtom, null);
  set(isRunningAtom, false);
});
