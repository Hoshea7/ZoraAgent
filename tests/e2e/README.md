# E2E 测试

Playwright 启动真实 Electron 应用，通过真实 Provider 和真实模型验证端到端行为。

## 运行

```bash
# 全量（仅在整套方案收尾时跑）
bun run test:e2e

# 单个切片（日常按切片验收，节省真实调用资源）
bun run test:e2e:spec tests/e2e/tool-authorization.spec.ts
```

默认读取本机 `~/.zora/providers.json` 中已启用的默认 Provider。指定其他：

```bash
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:e2e:spec tests/e2e/conversation.spec.ts

# 图片附件：Provider 必须配置视觉模型，默认选择 MiniMax-M3
ZORA_E2E_PROVIDER_ID=<vision-provider-id> ZORA_E2E_IMAGE_MODEL_ID=minimax-m3 \
  bun run test:e2e:spec tests/e2e/attachments.spec.ts
```

完整测试列表可用：

```bash
bunx playwright test --config tests/e2e/playwright.config.ts --list
```

## 设计原则

**每个 spec 对应一个垂直切片，用"一个真人会怎么验证这个能力是好的"来设计流程。**

1. **走真实用户路径**：点选择器、填输入框、按回车、点审批按钮。不直接调 IPC，不注入内部状态。
2. **断言落在 AgentTrace 上，不只看最终文本**。过程视图（`.ai-process-content`）暴露因果链：
   思考 → 工具调用 → 结果 → 正文。只断言最终回复会漏掉"工具执行了但 UI 没回显"
   "正文先于过程出现"这类真实缺陷。
3. **让真实模型自己决定调用哪个工具**。如果它调不出预期工具，本身就是发现：
   可能工具未注册、schema 为空、或 system prompt 没描述该工具。
4. **两个 Runtime 参数化跑同一流程**（`RUNTIMES`），差异必须由 `RuntimeCapabilities`
   显式声明，不允许静默缺失。

## 隔离

每个 test case 拿到独立 temp HOME，预置 providers.json / memory-settings.json / mcp.json。
Electron 进程目录、ZORA_HOME、默认会话目录和显式文件写入目录都位于该用例的运行目录中。
通过后清理。失败时保留截图、Renderer 日志、主进程日志和会话现场，复制的 Provider 凭据始终删除。下一次 E2E 启动时清理上一次遗留现场。

## 与 L1、L2 的分工

| 层 | 栈 | 职责 |
|---|---|---|
| L1 Unit | Vitest | 纯函数、单模块规则和确定性状态转换 |
| L2 Integration | Vitest + fake/临时目录/本地服务 | IPC 合同、持久化、Runtime 装配和跨模块协作 |
| L3 E2E | Playwright + 真实 Electron/Provider | 可见 UI 到正式 Agent Runtime 的完整用户闭环 |

精确 SDK 时序语义（如 steer 注入当前运行、beforeToolCall 阻止工具主体执行）由 L1/L2 覆盖；
E2E 验证用户视角的结果和可见事件链。运行中引导用例在首个 thinking 或文本事件出现后发送追加消息，避免等待任务完成后才测试引导路径。

E2E 按用户目标划分。确定性错误、数据合并、并发上限和取消传播放在 L1/L2，避免重复调用真实模型。Provider 连接测试用例需要在同一配置上继续完成正式 Query，验证连接测试与实际运行一致。
