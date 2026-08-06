import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface OpenAiMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

interface OpenAiRequest {
  messages?: OpenAiMessage[];
}

function readJson(request: IncomingMessage): Promise<OpenAiRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as OpenAiRequest);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendEvent(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendAnthropicEvent(
  response: ServerResponse,
  event: string,
  payload: unknown
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function messageText(message: OpenAiMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    ?.map((item) => item.text ?? "")
    .join("") ?? "";
}

function sendAnthropicText(
  response: ServerResponse,
  text: string
): void {
  sendAnthropicEvent(response, "message_start", {
    type: "message_start",
    message: {
      id: "msg_zora_e2e",
      type: "message",
      role: "assistant",
      content: [],
      model: "zora-e2e-anthropic",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });
  sendAnthropicEvent(response, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  sendAnthropicEvent(response, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
  sendAnthropicEvent(response, "content_block_stop", { type: "content_block_stop", index: 0 });
  sendAnthropicEvent(response, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 4 },
  });
  sendAnthropicEvent(response, "message_stop", { type: "message_stop" });
}

function completionChunk(
  id: string,
  delta: Record<string, unknown>,
  finishReason: string | null
): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "zora-e2e-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export interface OpenAiTestServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startOpenAiTestServer(
  packageJsonPath: string
): Promise<OpenAiTestServer> {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const isChatCompletions = /\/(?:v1\/)?chat\/completions\/?$/.test(pathname);
    const isAnthropicMessages = /\/(?:v1\/)?messages\/?$/.test(pathname);
    if (request.method !== "POST" || (!isChatCompletions && !isAnthropicMessages)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: `Unexpected E2E provider request: ${request.method ?? "UNKNOWN"} ${pathname}`,
        })
      );
      return;
    }

    try {
      const body = await readJson(request);
      if (isAnthropicMessages) {
        const texts = (body.messages ?? []).map(messageText);
        const latestUserText = [...(body.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user");
        const latestText = latestUserText ? messageText(latestUserText) : "";
        const hasPreviousContext = texts.some((text) =>
          text.includes("E2E_CONTEXT_ALPHA")
        );

        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        sendAnthropicText(
          response,
          latestText.includes("E2E_CLAUDE_TURN")
            ? "E2E_CLAUDE_REPLY"
            : latestText.includes("E2E_CONTEXT_CHECK") && hasPreviousContext
              ? "E2E_CONTEXT_PASS"
              : "E2E_CONTEXT_SAVED"
        );
        response.end();
        return;
      }

      const hasToolResult = body.messages?.some((message) => message.role === "tool") ?? false;
      const allMessageText = (body.messages ?? []).map(messageText).join("\n");
      const latestUserText = [...(body.messages ?? [])]
        .reverse()
        .find((message) => message.role === "user");
      const latestUserContent = latestUserText ? messageText(latestUserText) : "";

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      if (latestUserContent.includes("E2E_THINKING_ORDER")) {
        const id = "chatcmpl-zora-e2e-thinking-order";
        sendEvent(
          response,
          completionChunk(
            id,
            { role: "assistant", reasoning_content: "Checking context before answering." },
            null
          )
        );
        await new Promise((resolve) => setTimeout(resolve, 700));
        sendEvent(
          response,
          completionChunk(id, { content: "E2E_THINKING_REPLY" }, null)
        );
        sendEvent(response, completionChunk(id, {}, "stop"));
      } else if (
        !hasToolResult &&
        latestUserContent.includes("E2E_THINKING_TOOL")
      ) {
        const id = "chatcmpl-zora-e2e-thinking-tool";
        sendEvent(
          response,
          completionChunk(
            id,
            { role: "assistant", reasoning_content: "I should inspect the package file." },
            null
          )
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        sendEvent(
          response,
          completionChunk(
            id,
            {
              tool_calls: [{
                index: 0,
                id: "call_thinking_read",
                type: "function",
                function: {
                  name: "read",
                  arguments: JSON.stringify({ path: packageJsonPath }),
                },
              }],
            },
            null
          )
        );
        sendEvent(response, completionChunk(id, {}, "tool_calls"));
      } else if (
        hasToolResult &&
        allMessageText.includes("E2E_THINKING_TOOL")
      ) {
        const id = "chatcmpl-zora-e2e-thinking-tool-done";
        sendEvent(
          response,
          completionChunk(id, { role: "assistant", content: "E2E_THINKING_TOOL_REPLY" }, null)
        );
        sendEvent(response, completionChunk(id, {}, "stop"));
      } else if (latestUserContent.includes("E2E_SLOW_STOP")) {
        const id = "chatcmpl-zora-e2e-slow";
        sendEvent(response, completionChunk(id, { role: "assistant", content: "E2E_SLOW_STARTED" }, null));
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        if (!response.destroyed) {
          sendEvent(response, completionChunk(id, { content: "E2E_SLOW_FINISHED" }, null));
          sendEvent(response, completionChunk(id, {}, "stop"));
        }
      } else if (latestUserContent.includes("E2E_QUEUE_START")) {
        const id = "chatcmpl-zora-e2e-queue-start";
        await new Promise((resolve) => setTimeout(resolve, 700));
        sendEvent(response, completionChunk(id, { role: "assistant", content: "E2E_QUEUE_READY" }, null));
        sendEvent(response, completionChunk(id, {}, "stop"));
      } else if (latestUserContent.includes("E2E_QUEUE_NEXT")) {
        const id = "chatcmpl-zora-e2e-queue-next";
        sendEvent(response, completionChunk(id, { role: "assistant", content: "E2E_QUEUE_REPLY" }, null));
        sendEvent(response, completionChunk(id, {}, "stop"));
      } else if (
        !hasToolResult &&
        latestUserContent.includes("E2E_PERMISSION_WRITE")
      ) {
        const id = "chatcmpl-zora-e2e-permission";
        sendEvent(
          response,
          completionChunk(
            id,
            {
              role: "assistant",
              tool_calls: [{
                index: 0,
                id: "call_write_permission",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    path: "permission-e2e.txt",
                    content: "permission granted",
                  }),
                },
              }],
            },
            null
          )
        );
        sendEvent(response, completionChunk(id, {}, "tool_calls"));
      } else if (hasToolResult && allMessageText.includes("E2E_PERMISSION_WRITE")) {
        const id = "chatcmpl-zora-e2e-permission-done";
        sendEvent(
          response,
          completionChunk(
            id,
            { role: "assistant", content: "E2E_PERMISSION_ALLOWED" },
            null
          )
        );
        sendEvent(response, completionChunk(id, {}, "stop"));
      } else if (!hasToolResult) {
        const id = "chatcmpl-zora-e2e-tool";
        sendEvent(
          response,
          completionChunk(
            id,
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_read_package",
                  type: "function",
                  function: {
                    name: "read",
                    arguments: JSON.stringify({ path: packageJsonPath }),
                  },
                },
              ],
            },
            null
          )
        );
        sendEvent(response, completionChunk(id, {}, "tool_calls"));
      } else {
        const id = "chatcmpl-zora-e2e-reply";
        sendEvent(
          response,
          completionChunk(
            id,
            { role: "assistant", content: "E2E_PI_REPLY: zora" },
            null
          )
        );
        sendEvent(response, completionChunk(id, {}, "stop"));
      }

      response.write("data: [DONE]\n\n");
      response.end();
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
