import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { AgentStreamEvent } from "../../shared/zora";
import {
  FEISHU_IPC,
  type FeishuConfig,
  type FeishuAgentStatePayload,
  type FeishuBridgeStatus,
  type FeishuChatBinding,
  type FeishuChatType,
} from "../../shared/types/feishu";
import { agentExecutionService } from "../agent-execution-service";
import { runPromptInSession } from "../session-runner";
import { getErrorMessage, logSystemEvent } from "../system-log";
import {
  getSessionMeta,
  loadMessages,
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

  private async resolveStartConfig(nextConfig?: FeishuConfig): Promise<FeishuConfig> {
    if (nextConfig) {
      return saveFeishuConfig({
        ...nextConfig,
        enabled: true,
      });
    }

    const savedConfig = await loadFeishuConfig();
    if (!savedConfig) {
      throw new Error("请先配置飞书 App ID 和 App Secret。");
    }

    if (savedConfig.enabled) {
      return savedConfig;
    }

    return saveFeishuConfig({
      ...savedConfig,
      enabled: true,
    });
  }

  async start(nextConfig?: FeishuConfig): Promise<FeishuConfig> {
    if (this.status === "running" || this.status === "starting") {
      const existingConfig = await loadFeishuConfig();
      if (!existingConfig) {
        throw new Error("请先配置飞书 App ID 和 App Secret。");
      }
      return existingConfig;
    }

    const config = await this.resolveStartConfig(nextConfig);

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
      return config;
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

  private notifyAgentStreamEvent(sessionId: string, payload: AgentStreamEvent): void {
    const event = {
      ...payload,
      sessionId,
    };

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("agent:stream", event);
      }
    }
  }

  private async notifySessionSync(
    binding: FeishuChatBinding,
    runId: string
  ): Promise<void> {
    const [session, messages] = await Promise.all([
      getSessionMeta(binding.sessionId, binding.workspaceId),
      loadMessages(binding.sessionId, binding.workspaceId),
    ]);

    this.notifyAgentStreamEvent(binding.sessionId, {
      type: "session_sync",
      source: "feishu",
      sessionId: binding.sessionId,
      runId,
      workspaceId: binding.workspaceId,
      session,
      messages,
    });
  }

  private createFeishuForwarder(
    sessionId: string
  ): (payload: AgentStreamEvent) => void {
    return (payload: AgentStreamEvent) => {
      this.sender.handleAgentEvent(sessionId, payload);
      this.notifyAgentStreamEvent(sessionId, payload);
    };
  }

  private async handleAgentTrigger(
    chatId: string,
    senderId: string,
    chatType: FeishuChatType,
    text: string,
    userMessageId: string
  ): Promise<void> {
    const binding = await this.binder.resolveBinding(chatId, senderId, chatType);
    const runInfo = agentExecutionService.getRunInfo(binding.sessionId);

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
    const runId = randomUUID();

    try {
      await runPromptInSession({
        sessionId: binding.sessionId,
        runId,
        text,
        workspaceId: binding.workspaceId,
        permissionMode: "unattended",
        source: "feishu",
        waitForCompletion: true,
        userMessageId: userMessageId
          ? `feishu-user-${userMessageId}`
          : undefined,
        beforeRun: () => this.notifySessionSync(binding, runId),
        forwardEvent: this.createFeishuForwarder(binding.sessionId),
      });
      await this.sender.onAgentEnd(binding.sessionId, "success");
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logSystemEvent(
        "feishu",
        "bridge",
        "agent:error",
        "飞书触发 Agent 失败",
        {
          sessionId: binding.sessionId,
          workspaceId: binding.workspaceId,
          error: errorMessage,
        },
        { level: "error" }
      );
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
