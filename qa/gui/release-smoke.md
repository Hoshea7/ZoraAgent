# 发版验证历史存档

状态：旧版 GUI / Computer Use 巡检流程已退役。

当前发版前验证使用真实 Provider 的 Electron E2E 和 SDK 诊断，不再执行 `test:gui:*` 或 Computer Use 剧本。现役流程如下：

```bash
bun run typecheck
bun run test
bun run build
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:e2e
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:live
```

## 现役 E2E 范围

`tests/e2e/` 当前包含 12 个 spec、49 个真实用户流程测试，覆盖：

- Claude / Pi 基础对话、文件工具和跨 Runtime 上下文连续性。
- 运行中引导、停止、引导附件和独立 Assistant Turn。
- 文本附件、图片附件、用户自定义 MCP、内置 MCP。
- 工具授权、AskUser、Todo、Skills、Fork 和事件渲染。

测试通过可见 Electron 界面完成交互，使用隔离 HOME 和真实 Provider。完整 E2E 需要本机可用的 Provider，缺少配置时应明确标记为 `pending`。

## 历史剧本

- `cases/pi-runtime-basic.md`：Pi Runtime 接入阶段的人工验收清单。
- `product-rules.md`：接入阶段沉淀的产品规则，现役断言以源码和 `tests/e2e/` 为准。
