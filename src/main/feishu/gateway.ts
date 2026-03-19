import * as lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig, FeishuConnectionTestResult } from "../../shared/types/feishu";
import { isRecord } from "../utils/guards";
import { normalizeRequiredString, normalizeOptionalString } from "../utils/validate";

const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn";
const FEISHU_REST_TIMEOUT_MS = 10_000;
const WS_READY_TIMEOUT_MS = 15_000;
const WS_READY_POLL_INTERVAL_MS = 100;
const TYPING_REACTION_EMOJI = "Typing";

type InternalWsInstance = {
  readyState?: number;
};

type InternalWsClient = {
  wsConfig?: {
    getWSInstance?: () => InternalWsInstance | null;
  };
};

function getLarkResponseErrorMessage(
  response: { code?: number; msg?: string },
  fallback: string
): string | null {
  if (response.code === undefined || response.code === 0) {
    return null;
  }

  if (typeof response.msg === "string" && response.msg.trim().length > 0) {
    return response.msg.trim();
  }

  return `${fallback} (code: ${response.code})`;
}

function stringifyError(error: unknown): string {
  if (isRecord(error)) {
    const response = isRecord(error.response) ? error.response : null;
    const data = response && isRecord(response.data) ? response.data : null;

    if (data && typeof data.msg === "string" && data.msg.trim().length > 0) {
      return data.msg.trim();
    }

    if (response && typeof response.status === "number") {
      return `请求失败 (${response.status})`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : String(error);
}

function createRestClient(appId: string, appSecret: string): lark.Client {
  return new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });
}

function isWsClientReady(client: lark.WSClient): boolean {
  const wsInstance = (client as unknown as InternalWsClient).wsConfig?.getWSInstance?.();
  return wsInstance?.readyState === 1;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchFeishuJson(
  url: string,
  init: RequestInit,
  fallbackErrorMessage: string
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, FEISHU_REST_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const payloadErrorMessage = getLarkResponseErrorMessage(
      isRecord(payload) ? payload : {},
      fallbackErrorMessage
    );

    if (payloadErrorMessage) {
      throw new Error(payloadErrorMessage);
    }

    if (!response.ok) {
      throw new Error(
        normalizeOptionalString(response.statusText) ??
          `${fallbackErrorMessage} (${response.status})`
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${fallbackErrorMessage} 超时，请稍后重试。`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createTenantAccessToken(
  appId: string,
  appSecret: string
): Promise<string> {
  const payload = await fetchFeishuJson(
    `${FEISHU_OPEN_API_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    },
    "获取 tenant access token 失败"
  );

  if (!isRecord(payload)) {
    throw new Error("获取 tenant access token 失败。");
  }

  const token =
    normalizeOptionalString(payload.tenant_access_token) ??
    (isRecord(payload.data) ? normalizeOptionalString(payload.data.tenant_access_token) : null);

  if (!token) {
    throw new Error("飞书返回了空的 tenant access token。");
  }

  return token;
}

function extractBotInfoFromPayload(payload: unknown): {
  botName: string | null;
  botOpenId: string | null;
} {
  if (!isRecord(payload)) {
    return {
      botName: null,
      botOpenId: null,
    };
  }

  const bot = isRecord(payload.bot)
    ? payload.bot
    : isRecord(payload.data) && isRecord(payload.data.bot)
      ? payload.data.bot
      : null;

  if (!bot) {
    return {
      botName: null,
      botOpenId: null,
    };
  }

  return {
    botName: normalizeOptionalString(bot.app_name) ?? normalizeOptionalString(bot.name),
    botOpenId: normalizeOptionalString(bot.open_id),
  };
}

async function waitForWsReady(client: lark.WSClient): Promise<void> {
  const deadline = Date.now() + WS_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (isWsClientReady(client)) {
      return;
    }

    await delay(WS_READY_POLL_INTERVAL_MS);
  }

  throw new Error(
    "飞书长连接启动超时，请检查开放平台的长连接、事件订阅和应用发布状态。"
  );
}

async function fetchBotInfo(appId: string, appSecret: string): Promise<{
  botName: string | null;
  botOpenId: string | null;
}> {
  const tenantAccessToken = await createTenantAccessToken(appId, appSecret);
  const payload = await fetchFeishuJson(
    `${FEISHU_OPEN_API_BASE_URL}/open-apis/bot/v3/info/`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
      },
    },
    "读取 Bot 信息失败"
  );

  return extractBotInfoFromPayload(payload);
}

export async function testFeishuConnection(
  appId: string,
  appSecret: string
): Promise<FeishuConnectionTestResult> {
  const normalizedAppId = normalizeRequiredString(appId, "feishu.appId");
  const normalizedAppSecret = normalizeRequiredString(appSecret, "feishu.appSecret");

  try {
    const tenantAccessToken = await createTenantAccessToken(normalizedAppId, normalizedAppSecret);

    let botName: string | null = null;
    try {
      const payload = await fetchFeishuJson(
        `${FEISHU_OPEN_API_BASE_URL}/open-apis/bot/v3/info/`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tenantAccessToken}` },
        },
        "读取 Bot 信息失败"
      );
      const info = extractBotInfoFromPayload(payload);
      botName = info.botName;
    } catch (error) {
      console.warn("[feishu:test] Failed to fetch bot info:", error);
    }

    return { success: true, error: null, botName };
  } catch (error) {
    console.error("[feishu:test] Connection test failed:", error);
    return { success: false, error: stringifyError(error), botName: null };
  }
}

export class FeishuGateway {
  private wsClient: lark.WSClient | null = null;
  private restClient: lark.Client | null = null;
  private botOpenId: string | null = null;
  private botName: string | null = null;

  onMessage: ((data: unknown) => Promise<void>) | null = null;

  async start(config: FeishuConfig): Promise<void> {
    const appId = normalizeRequiredString(config.appId, "feishu.appId");
    const appSecret = normalizeRequiredString(config.appSecret, "feishu.appSecret");

    await this.stop();

    const restClient = createRestClient(appId, appSecret);
    this.restClient = restClient;
    this.botName = null;
    this.botOpenId = null;

    try {
      const botInfo = await fetchBotInfo(appId, appSecret);
      this.botName = botInfo.botName;
      this.botOpenId = botInfo.botOpenId;
    } catch (error) {
      // Bot 资料只用于状态展示和群聊过滤，拿不到时不应阻塞长连接建立。
      console.warn("[feishu:start] Failed to fetch bot info before websocket start:", error);
    }

    const eventDispatcher = new lark.EventDispatcher({
      loggerLevel: lark.LoggerLevel.warn,
    }).register({
      "im.message.receive_v1": (data: unknown) => {
        if (!this.onMessage) {
          return;
        }

        void Promise.resolve()
          .then(() => this.onMessage?.(data))
          .catch((error) => {
            console.error("[FeishuGateway] Message handling error:", error);
          });
      },
    });

    const wsClient = new lark.WSClient({
      appId,
      appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.warn,
    });

    this.wsClient = wsClient;

    try {
      await wsClient.start({ eventDispatcher });
      await waitForWsReady(wsClient);
    } catch (error) {
      await this.stop();
      const message = stringifyError(error);

      if (error instanceof Error && message === error.message) {
        throw error;
      }

      throw new Error(message);
    }
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = null;
    }

    this.restClient = null;
    this.botOpenId = null;
    this.botName = null;
  }

  isRunning(): boolean {
    return this.wsClient !== null;
  }

  getBotOpenId(): string | null {
    return this.botOpenId;
  }

  getBotName(): string | null {
    return this.botName;
  }

  getRestClient(): lark.Client | null {
    return this.restClient;
  }

  async sendMessage(chatId: string, msgType: string, content: string): Promise<string> {
    if (!this.restClient) {
      throw new Error("飞书 Bridge 尚未启动，无法发送消息。");
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: msgType,
        content,
      },
    });

    const errorMessage = getLarkResponseErrorMessage(response, "发送飞书消息失败");
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return response.data?.message_id ?? "";
  }

  async replyMessage(messageId: string, msgType: string, content: string): Promise<string> {
    if (!this.restClient) {
      throw new Error("飞书 Bridge 尚未启动，无法回复消息。");
    }

    const response = await this.restClient.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: msgType,
        content,
      },
    });

    const errorMessage = getLarkResponseErrorMessage(response, "回复飞书消息失败");
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return response.data?.message_id ?? "";
  }

  async patchMessage(messageId: string, cardJson: object): Promise<boolean> {
    if (!this.restClient) {
      return false;
    }

    try {
      const response = await this.restClient.im.message.patch({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify(cardJson),
        },
      });

      const errorMessage = getLarkResponseErrorMessage(response, "更新飞书卡片消息失败");
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      return true;
    } catch (error) {
      console.error("[Feishu Gateway] Failed to patch message:", error);
      return false;
    }
  }

  async addTypingReaction(messageId: string): Promise<string | null> {
    if (!this.restClient) {
      return null;
    }

    // Requires `im:message.reactions:read` / `im:message.reactions:write_only`.
    // This is best-effort only: missing permission should not break reply flow.
    try {
      const response = await this.restClient.im.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: {
            emoji_type: TYPING_REACTION_EMOJI,
          },
        },
      });
      const errorMessage = getLarkResponseErrorMessage(response, "添加飞书打字指示器失败");
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      return normalizeOptionalString(response.data?.reaction_id);
    } catch (error) {
      console.warn("[Feishu Gateway] Typing reaction failed:", error);
      return null;
    }
  }

  async removeTypingReaction(
    messageId: string,
    reactionId?: string | null
  ): Promise<void> {
    if (!this.restClient || !reactionId) {
      return;
    }

    try {
      let resolvedReactionId = normalizeOptionalString(reactionId);

      if (!resolvedReactionId) {
        const listResponse = await this.restClient.im.messageReaction.list({
          path: { message_id: messageId },
          params: {
            reaction_type: TYPING_REACTION_EMOJI,
          },
        });
        const listError = getLarkResponseErrorMessage(
          listResponse,
          "读取飞书打字指示器失败"
        );
        if (listError) {
          throw new Error(listError);
        }

        resolvedReactionId =
          listResponse.data?.items.find(
            (item) =>
              item.operator?.operator_type === "app" &&
              item.reaction_type?.emoji_type === TYPING_REACTION_EMOJI
          )?.reaction_id ?? null;
      }

      if (!resolvedReactionId) {
        return;
      }

      const deleteResponse = await this.restClient.im.messageReaction.delete({
        path: {
          message_id: messageId,
          reaction_id: resolvedReactionId,
        },
      });
      const deleteError = getLarkResponseErrorMessage(
        deleteResponse,
        "移除飞书打字指示器失败"
      );
      if (deleteError) {
        throw new Error(deleteError);
      }
    } catch (error) {
      console.warn("[Feishu Gateway] Remove typing reaction failed:", error);
    }
  }

  rememberBotIdentity(identity: { openId?: string | null; name?: string | null }): void {
    if (!this.botOpenId && identity.openId) {
      this.botOpenId = identity.openId;
    }

    if (!this.botName && identity.name) {
      this.botName = identity.name;
    }
  }
}
