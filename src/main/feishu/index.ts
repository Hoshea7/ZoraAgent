import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import type { AgentStreamEvent } from "../../shared/zora";
import {
  FEISHU_IPC,
  type FeishuAgentStatePayload,
  type FeishuBridgeStatus,
  type FeishuChatBinding,
  type FeishuChatType,
} from "../../shared/types/feishu";
import { getAgentRunInfo } from "../agent";
import { memoryAgent } from "../memory-agent";
import { runProductivitySession } from "../productivity-runner";
import {
  appendMessageRecord,
  persistAssistantMessage,
  persistToolResults,
  updateSessionMeta,
} from "../session-store";
import { loadFeishuConfig, saveFeishuConfig } from "./config";
import { FeishuGateway, testFeishuConnection } from "./gateway";
import { FeishuMessageHandler } from "./message-handler";
import { FeishuMessageSender } from "./message-sender";
import { FeishuSessionBinder } from "./session-binder";

export class FeishuBridge {
  private gateway = new FeishuGateway();
  private handler = new FeishuMessageHandler();
  private binder = new FeishuSessionBinder();
  private sender = new FeishuMessageSender(this.gateway);
  private busySessions = new Set<string>();
  private status: FeishuBridgeStatus["status"] = "stopped";
  private error: string | null = null;

  constructor() {
    this.handler.setGateway(this.gateway);
    this.handler.setBinder(this.binder);
    this.handler.setTriggerAgent(async (chatId, senderId, chatType, text, userMessageId) => {
      await this.handleAgentTrigger(chatId, senderId, chatType, text, userMessageId);
    });
    this.gateway.onMessage = async (data) => {
      await this.handler.handleMessage(data);
    };
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      return;
    }

    const config = await loadFeishuConfig();

    if (!config?.enabled) {
      throw new Error("飞书 Bridge 未启用，请先在设置中打开启用开关。");
    }

    if (!config.appId || !config.appSecret) {
      throw new Error("请先配置飞书 App ID 和 App Secret。");
    }

    this.status = "starting";
    this.error = null;
    this.notifyStatusChange();

    try {
      await this.handler.init();
      await this.gateway.start(config);
      await this.binder.loadBindings();
      this.status = "running";
      this.error = null;
      this.notifyStatusChange();
    } catch (error) {
      await this.gateway.stop().catch(() => undefined);
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.notifyStatusChange();
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.gateway.stop();
    await this.handler.shutdown();
    this.status = "stopped";
    this.error = null;
    this.notifyStatusChange();
  }

  getStatus(): FeishuBridgeStatus {
    return {
      status: this.status,
      error: this.error,
      botName: this.gateway.getBotName(),
    };
  }

  private notifyStatusChange(): void {
    const status = this.getStatus();

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(FEISHU_IPC.STATUS_CHANGED, status);
      }
    }
  }

  private notifyAgentStateChange(payload: FeishuAgentStatePayload): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(FEISHU_IPC.AGENT_STATE, payload);
      }
    }
  }

  private createFeishuForwarder(
    sessionId: string,
    workspaceId: string
  ): (payload: AgentStreamEvent) => void {
    return (payload: AgentStreamEvent) => {
      this.sender.handleAgentEvent(sessionId, payload);

      if (typeof payload !== "object" || payload === null) return;

      if (payload.type === "assistant" && "message" in payload) {
        persistAssistantMessage(sessionId, payload.message, workspaceId);
      } else if (payload.type === "user" && "message" in payload) {
        persistToolResults(sessionId, payload.message, workspaceId);
      }
    };
  }

  private async persistIncomingMessage(
    binding: FeishuChatBinding,
    text: string,
    userMessageId: string
  ): Promise<void> {
    await updateSessionMeta(binding.sessionId, {}, binding.workspaceId);
    await appendMessageRecord(
      binding.sessionId,
      {
        kind: "user",
        message: {
          id: `feishu-user-${userMessageId || randomUUID()}`,
          role: "user",
          type: "text",
          text,
          thinking: "",
          status: "done",
        },
      },
      binding.workspaceId
    );
    memoryAgent.scheduleProcessing(binding.sessionId, binding.workspaceId);
  }

  private async handleAgentTrigger(
    chatId: string,
    senderId: string,
    chatType: FeishuChatType,
    text: string,
    userMessageId: string
  ): Promise<void> {
    const binding = await this.binder.resolveBinding(chatId, senderId, chatType);
    const runInfo = getAgentRunInfo(binding.sessionId);

    if (this.busySessions.has(binding.sessionId) || runInfo.running) {
      const busyText =
        runInfo.running && runInfo.source === "desktop"
          ? "⏳ Zora 正在桌面端处理任务…"
          : "⏳ Zora 正在处理上一条消息，请稍候…";
      await this.sender.sendText(chatId, busyText, userMessageId);
      return;
    }

    await this.sender.onAgentStart(chatId, userMessageId, binding.sessionId);
    this.busySessions.add(binding.sessionId);
    this.notifyAgentStateChange({ sessionId: binding.sessionId, running: true });

    try {
      await this.persistIncomingMessage(binding, text, userMessageId);
      await runProductivitySession({
        sessionId: binding.sessionId,
        text,
        workspaceId: binding.workspaceId,
        permissionMode: "bypassPermissions",
        source: "feishu",
        forwardEvent: this.createFeishuForwarder(
          binding.sessionId,
          binding.workspaceId
        ),
      });
      await this.sender.onAgentEnd(binding.sessionId, "success");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Feishu] Agent error:", error);
      this.sender.markError(binding.sessionId, `❌ 出错了: ${errorMessage}`);
      await this.sender.onAgentEnd(binding.sessionId, "error");
    } finally {
      this.busySessions.delete(binding.sessionId);
      this.notifyAgentStateChange({ sessionId: binding.sessionId, running: false });
    }
  }
}

export const feishuBridge = new FeishuBridge();

export { loadFeishuConfig, saveFeishuConfig, testFeishuConnection };
