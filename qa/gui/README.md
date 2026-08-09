# GUI 巡检历史存档

状态：退役。

Zora 当前统一使用 Playwright Electron E2E 验证用户流程，现役入口为 [`tests/e2e/README.md`](../../tests/e2e/README.md) 和 `bun run test:e2e`。本目录不再作为 Computer Use、GUI 启动脚本或发版门禁的入口。

保留本目录是为了保留早期产品规则和人工巡检记录。这里的内容只能作为历史背景，能力结论以当前源码、`tests/e2e/`、L1/L2 测试和真实 Provider 验证结果为准。

## 现役验证入口

```bash
# 类型、L1/L2 和构建
bun run typecheck
bun run test
bun run build

# 真实 Provider Electron E2E
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:e2e

# SDK 连通性诊断
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:live
```

E2E 使用隔离 HOME，测试通过后清理测试 HOME，失败时保留截图和 Electron/Renderer 日志。E2E 剧本覆盖 Runtime 切换、停止、运行中引导、附件、MCP、权限、AskUser、Todo、Fork、Skills 和事件渲染。
