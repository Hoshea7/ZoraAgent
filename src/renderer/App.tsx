import { useEffect, useRef } from "react";
import { atom, useAtom, useSetAtom } from "jotai";
import type { AgentStreamEvent } from "../shared/zora";

const appVersionAtom = atom("Loading...");
const draftAtom = atom("");
const isRunningAtom = atom(false);

type ChatMessageStatus = "streaming" | "done" | "stopped" | "error";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  status: ChatMessageStatus;
  error?: string;
};

const messagesAtom = atom<ChatMessage[]>([]);
const currentAssistantIdAtom = atom<string | null>(null);

const startConversationAtom = atom(null, (_get, set, prompt: string) => {
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

const appendAssistantTextAtom = atom(null, (get, set, chunk: string) => {
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

const appendAssistantThinkingAtom = atom(null, (get, set, chunk: string) => {
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

const hydrateAssistantAtom = atom(
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

const completeConversationAtom = atom(
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

const failConversationAtom = atom(null, (get, set, errorMessage: string) => {
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

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getAgentErrorText(error: unknown) {
  return typeof error === "string" ? error : "Unknown agent error.";
}

function extractContentBlockText(block: unknown) {
  if (!isRecord(block)) {
    return "";
  }

  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }

  return "";
}

function extractContentBlockThinking(block: unknown) {
  if (!isRecord(block)) {
    return "";
  }

  if (block.type === "thinking" && typeof block.thinking === "string") {
    return block.thinking;
  }

  return "";
}

function extractStreamChunks(streamEvent: AgentStreamEvent) {
  if (streamEvent.type !== "stream_event" || !isRecord(streamEvent.event)) {
    return { text: "", thinking: "" };
  }

  const event = streamEvent.event;

  if (event.type === "content_block_start") {
    return {
      text: extractContentBlockText(event.content_block),
      thinking: extractContentBlockThinking(event.content_block)
    };
  }

  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      return { text: event.delta.text, thinking: "" };
    }

    if (
      event.delta.type === "thinking_delta" &&
      typeof event.delta.thinking === "string"
    ) {
      return { text: "", thinking: event.delta.thinking };
    }
  }

  return { text: "", thinking: "" };
}

function extractAssistantPayload(message: unknown) {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return { text: "", thinking: "" };
  }

  let text = "";
  let thinking = "";

  for (const block of message.content) {
    text += extractContentBlockText(block);
    thinking += extractContentBlockThinking(block);
  }

  return { text, thinking };
}

export default function App() {
  const [version, setVersion] = useAtom(appVersionAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const [messages] = useAtom(messagesAtom);
  const [isRunning, setIsRunning] = useAtom(isRunningAtom);
  const startConversation = useSetAtom(startConversationAtom);
  const appendAssistantText = useSetAtom(appendAssistantTextAtom);
  const appendAssistantThinking = useSetAtom(appendAssistantThinkingAtom);
  const hydrateAssistant = useSetAtom(hydrateAssistantAtom);
  const completeConversation = useSetAtom(completeConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    window.zora
      .getAppVersion()
      .then((value) => {
        if (!cancelled) {
          setVersion(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersion("Unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setVersion]);

  useEffect(() => {
    return window.zora.onStream((streamEvent) => {
      if (streamEvent.type === "agent_error") {
        failConversation(getAgentErrorText(isRecord(streamEvent) ? streamEvent.error : undefined));
        return;
      }

      if (streamEvent.type === "agent_status") {
        if (streamEvent.status === "finished") {
          completeConversation("done");
        }

        if (streamEvent.status === "stopped") {
          completeConversation("stopped");
        }

        return;
      }

      if (streamEvent.type === "assistant") {
        hydrateAssistant(extractAssistantPayload(streamEvent.message));
        return;
      }

      if (streamEvent.type === "result") {
        completeConversation("done");
        return;
      }

      const chunks = extractStreamChunks(streamEvent);
      if (chunks.text) {
        appendAssistantText(chunks.text);
      }

      if (chunks.thinking) {
        appendAssistantThinking(chunks.thinking);
      }
    });
  }, [
    appendAssistantText,
    appendAssistantThinking,
    completeConversation,
    failConversation,
    hydrateAssistant
  ]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [messages]);

  async function handleSubmit() {
    const prompt = draft.trim();
    if (!prompt || isRunning) {
      return;
    }

    startConversation(prompt);
    setDraft("");

    try {
      await window.zora.chat(prompt);
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  }

  async function handleStop() {
    if (!isRunning) {
      return;
    }

    setIsRunning(false);

    try {
      await window.zora.stopAgent();
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f8f1e3_0%,_#efe3cf_42%,_#eadcc7_100%)] px-4 py-5 text-stone-900 sm:px-6 sm:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl gap-4 lg:grid-cols-[0.9fr_1.4fr]">
        <section className="relative overflow-hidden rounded-[28px] border border-stone-900/10 bg-[linear-gradient(180deg,_rgba(255,250,243,0.96)_0%,_rgba(245,236,221,0.96)_100%)] p-7 shadow-[0_25px_80px_rgba(90,55,28,0.16)] sm:p-8">
          <div className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(128,76,44,0.45),transparent)]" />
          <div className="inline-flex items-center rounded-full border border-stone-900/10 bg-white/70 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-stone-500">
            Claude Agent Bridge
          </div>
          <h1 className="mt-6 max-w-sm font-['Iowan_Old_Style','Palatino_Linotype','Book_Antiqua',serif] text-[clamp(2.6rem,6vw,5rem)] leading-[0.94] tracking-[-0.05em] text-stone-900">
            Zora
            <br />
            Conversation Desk
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-stone-700 sm:text-base">
            主进程里的 Claude Agent SDK 正在把流式事件推到前端。这里会实时拼接回复，
            同时把 thinking 事件收进可折叠的灰色记录区。
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-stone-900/8 bg-white/70 p-4">
              <div className="text-[0.68rem] uppercase tracking-[0.22em] text-stone-500">
                App Version
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-900">
                {version}
              </div>
            </div>
            <div className="rounded-[22px] border border-stone-900/8 bg-stone-950 px-4 py-4 text-stone-100">
              <div className="text-[0.68rem] uppercase tracking-[0.22em] text-stone-400">
                Bridge Surface
              </div>
              <div className="mt-3 text-sm leading-6 text-stone-200">
                <code className="rounded bg-white/10 px-2 py-1 text-[0.8rem]">
                  window.zora.chat()
                </code>
                <span className="mx-2 text-stone-500">+</span>
                <code className="rounded bg-white/10 px-2 py-1 text-[0.8rem]">
                  onStream()
                </code>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-[24px] border border-stone-900/8 bg-[rgba(132,74,43,0.08)] p-5">
            <div className="text-[0.68rem] uppercase tracking-[0.22em] text-stone-500">
              Session Notes
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-700">
              <li>回车发送，Shift + Enter 换行。</li>
              <li>停止按钮会真正调用 SDK 的中止能力。</li>
              <li>当前 `allowedTools` 仍保持空数组。</li>
            </ul>
          </div>
        </section>

        <section className="flex min-h-[40rem] flex-col overflow-hidden rounded-[30px] border border-stone-900/10 bg-[linear-gradient(180deg,_rgba(255,253,249,0.95)_0%,_rgba(249,241,230,0.94)_100%)] shadow-[0_30px_100px_rgba(90,55,28,0.14)]">
          <header className="flex items-center justify-between border-b border-stone-900/8 px-5 py-4 sm:px-6">
            <div>
              <div className="text-[0.68rem] uppercase tracking-[0.24em] text-stone-500">
                Live Transcript
              </div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-stone-900">
                Claude Agent Session
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
              <span
                className={`inline-flex h-2.5 w-2.5 rounded-full ${
                  isRunning ? "bg-amber-600" : "bg-emerald-600"
                }`}
              />
              {isRunning ? "Streaming" : "Idle"}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[26rem] items-center justify-center rounded-[28px] border border-dashed border-stone-900/10 bg-white/55 p-8 text-center">
                <div className="max-w-md">
                  <div className="text-[0.68rem] uppercase tracking-[0.24em] text-stone-500">
                    Ready
                  </div>
                  <h2 className="mt-3 font-['Iowan_Old_Style','Palatino_Linotype','Book_Antiqua',serif] text-4xl tracking-[-0.04em] text-stone-900">
                    Start a prompt to watch the reply arrive token by token.
                  </h2>
                  <p className="mt-4 text-sm leading-7 text-stone-700">
                    thinking 事件会收纳到灰色折叠区块，正式回答则在消息气泡里持续增长。
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`rounded-[26px] px-4 py-4 shadow-[0_16px_45px_rgba(70,40,20,0.06)] sm:px-5 ${
                      message.role === "user"
                        ? "ml-auto max-w-[85%] border border-stone-900/8 bg-stone-950 text-stone-50"
                        : "mr-auto max-w-[90%] border border-stone-900/8 bg-white/85 text-stone-900"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-current/60">
                        {message.role === "user" ? "You" : "Agent"}
                      </div>
                      {message.role === "assistant" && message.status === "streaming" ? (
                        <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.2em] text-amber-700">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-600" />
                          Live
                        </div>
                      ) : null}
                    </div>

                    {message.thinking ? (
                      <details className="mt-4 overflow-hidden rounded-[18px] border border-stone-900/8 bg-stone-200/65 text-stone-700">
                        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em]">
                          Thinking Trace
                        </summary>
                        <div className="border-t border-stone-900/8 px-4 py-3 text-sm leading-7 text-stone-700">
                          <pre className="m-0 whitespace-pre-wrap font-inherit">
                            {message.thinking}
                          </pre>
                        </div>
                      </details>
                    ) : null}

                    <div className="mt-4 whitespace-pre-wrap text-sm leading-7 sm:text-[0.96rem]">
                      {message.text || (
                        <span className="text-stone-500">Waiting for the first token...</span>
                      )}
                    </div>

                    {message.error ? (
                      <div className="mt-4 rounded-2xl border border-rose-900/10 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">
                        {message.error}
                      </div>
                    ) : null}
                  </article>
                ))}
                <div ref={scrollAnchorRef} />
              </div>
            )}
          </div>

          <footer className="border-t border-stone-900/8 bg-white/55 px-4 py-4 sm:px-6">
            <div className="rounded-[26px] border border-stone-900/10 bg-white/85 p-3 shadow-[0_15px_35px_rgba(90,55,28,0.08)]">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="Ask Claude Agent anything..."
                className="min-h-[96px] w-full resize-none border-0 bg-transparent px-2 py-2 text-base leading-7 text-stone-900 outline-none placeholder:text-stone-400"
              />

              <div className="mt-3 flex flex-col gap-3 border-t border-stone-900/8 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs uppercase tracking-[0.22em] text-stone-500">
                  Enter to send • Shift + Enter for newline
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleStop()}
                    disabled={!isRunning}
                    className="rounded-full border border-stone-900/12 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-900/30 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!draft.trim() || isRunning}
                    className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
