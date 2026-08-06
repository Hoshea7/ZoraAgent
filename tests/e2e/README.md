# E2E 测试

Playwright 直接启动 Electron 应用，通过真实 Provider 验证 Agent 端到端行为。不使用 mock server。

## 运行

```bash
bun run test:e2e
```

默认读取本机 `~/.zora/providers.json` 中已启用的默认 Provider。可通过环境变量指定：

```bash
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:e2e
```

## 测试设计原则

E2E 测试随 Feature 一起构建。每个 Feature 完成时，同步产出对应的 E2E 测试用例。详见 `AGENTS.md` 中的 E2E 测试规则。

## 隔离

每个 test case 拿到独立的 temp HOME 目录，预配置 providers.json / memory-settings.json / mcp.json。测试通过后自动清理，失败时保留现场（截图 + renderer 日志）。
