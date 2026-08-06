# Electron E2E

Playwright 直接启动编译后的 Electron 应用，并从用户界面完成核心流程。测试只通过可见界面操作和断言，不调用 renderer store、IPC handler 或 RuntimeAdapter。

## 稳定核心流程

```bash
bun run test:e2e
```

该命令启动同时支持 OpenAI Chat Completions 与 Anthropic Messages 的本地测试服务器，执行以下用户流程：

```text
RuntimeSelector → Composer → IPC → SessionRunner → Pi Runtime
→ OpenAI streaming protocol → Read tool → stream events → message UI
```

- 新会话默认选择 Pi，并通过 Read 工具读取文件。
- Pi 的思考区域先于正文出现，完成后不会延迟插入或改变顺序。
- 思考、Read 工具和最终回复使用同一事件链，工具步骤只渲染一次。
- 运行中追加消息，当前轮结束后继续处理。
- 长响应可停止，停止后同一会话可继续发送。
- Write 工具进入 Zora 权限确认，用户允许后继续执行。
- Anthropic Provider 下同一会话可执行 Pi → Claude → Pi 三轮对话，Pi 恢复 Zora 持久化历史。
- 模型配置页展示 Provider 图标和协议对应的 Runtime。

模型协议响应固定，Pi Agent、文件工具、会话、IPC 和 UI 均使用真实实现。该层适合日常开发和 CI，不消耗模型额度。

## 真实 Provider 冒烟

```bash
bun run test:e2e:live
```

默认使用本机 `~/.zora/providers.json` 中已启用的默认 Provider。也可以指定 Provider：

```bash
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:e2e:live
```

Provider 配置会复制到隔离 HOME。测试结束后自动删除包含 API key 的隔离 HOME，只保留日志、失败截图和 Playwright 结果。输出与报告不得记录 API key。

## 测试分工

- `test:unit`：纯函数和单模块行为。
- `test:integration`：主进程模块协作。
- `test:e2e`：稳定、可重复的 Electron 用户核心流程。
- `test:e2e:live`：真实 Provider 的最小用户流程诊断。
- Computer Use：视觉、文案、交互感受和探索式发版巡检。
