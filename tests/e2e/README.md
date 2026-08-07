# E2E 测试

Playwright 启动真实 Electron 应用，通过**真实 Provider 和真实模型**验证端到端行为。
不存在 mock provider / mock 引擎 —— 只有真实调用才能暴露"模型说了什么"与"产品实际做了什么"之间的偏差。

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
通过后清理，失败保留现场（截图 + renderer 日志 + main 进程日志）。

## 与单测的分工

| 层 | 栈 | 职责 |
|---|---|---|
| T1 契约合规 | vitest + fake 引擎 | adapter 必须调用 ToolGate；deny 不执行；结束清空 pending。快、可做 PR 门禁 |
| T2 装配一致 | vitest | 同一 ToolProvisioningPlan → 两 adapter 暴露相同 canonical 工具集 |
| T3 真实闭环 | Playwright + 真模型 | 本目录。UI→Agent 全链路，切片验收 |

精确时序语义（如 steer 注入当前运行而非排队）真实模型无法稳定复现，归 T1 覆盖；
E2E 只保证用户视角的结果正确（追加的消息不丢）。
