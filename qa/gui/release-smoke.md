# Release Smoke

发版前 L3 GUI Product Review 先跑少量核心剧本。目标不是穷尽所有边界，而是确认新用户能从零开始走到 Zora 主界面，并且核心 Agent 体验没有明显断裂。

## 自动化前置验证

执行 Computer Use 巡检前先运行：

```bash
bun run test:e2e
```

涉及 Provider、SDK 或 Runtime 路径变更时，再使用一个已确认兼容目标 Runtime 的 Provider 运行：

```bash
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:e2e:live
```

自动化 E2E 失败时先处理功能链路问题。通过后再进入视觉、文案、交互感受和探索式巡检。

## 必跑剧本

| Case | 标题 | 状态 |
|------|------|------|
| `L3-INIT-001` | 初始化：模型配置 → 唤醒 → 主界面 | active |
| `L3-RUNTIME-001` | Runtime 会话连续性与 Pi 产品能力 | active |

## L3-INIT-001 总目标

验证一个全新用户在隔离环境中可以完成：

1. 启动 Zora。
2. 看到模型配置引导。
3. 配置一个可用 Provider。
4. 进入 Awakening 唤醒流程。
5. 发送首轮自我介绍消息。
6. 收到 Zora 的自然回复。
7. 进入主界面并看到 session / chat / 设置等基础结构。
8. 本次运行的文件都写入隔离的 `home/.zora`，不污染开发者真实环境。

详细步骤见 `cases/init-model-awakening.md`。

## L3-RUNTIME-001 总目标

验证一个已有用户可以完成：

1. 使用 Pi 进行真实多轮对话并调用文件工具。
2. 在同一会话按轮次切换 Claude 与 Pi，历史上下文保持连续。
3. 运行中发送引导消息并得到体现引导内容的最终回复。
4. 使用附件、自定义 MCP、AskUser 和 Todo。
5. 从历史助手消息创建可继续使用的 Fork。

详细步骤见 `cases/pi-runtime-basic.md`。

## 执行入口

```bash
bun run test:gui:init
```

启动后由 Codex 通过 Computer Use 接管 `Electron` 应用窗口。

## 产物要求

每次执行都要生成：

```text
tests/.artifacts/gui/runs/<run-id>/
├── home/.zora/
├── logs/
├── screenshots/
└── report.md
```

`report.md` 必须包含：

- 执行时间和 commit 信息。
- Provider 来源，必须脱敏。
- 每一步的观察结果。
- 发现的问题和严重程度。
- 是否建议发版。
