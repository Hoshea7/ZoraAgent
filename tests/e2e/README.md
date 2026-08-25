# E2E 测试

Playwright 启动真实 Electron 应用，通过可见界面验证完整用户流程。需要 Agent 行为的用例使用正式 Runtime 和真实 Provider；确定性的产品交互使用隔离测试数据。

## 运行

```bash
# 全量，仅在整套方案收尾时跑
bun run test:e2e

# 确定性产品交互，不发起远程请求
bun run test:e2e:local

# 需要真实 Provider 的用例
bun run test:e2e:provider

# 按覆盖维度选择，Product 与 Agent 可以重叠
bun run test:e2e:product
bun run test:e2e:agent

# 单个切片，日常按切片验收
bun run test:e2e:spec tests/e2e/tool-authorization.spec.ts

# 默认显示一个不获取焦点的 Electron 窗口，便于观察测试过程且不切换当前应用。
# 调试时如需让测试窗口获得焦点：
ZORA_E2E_WINDOW_MODE=normal ZORA_E2E_VISIBLE=1 bun run test:e2e:spec tests/e2e/tool-authorization.spec.ts
```

带 `@provider` 标签的用例读取本机 `~/.zora/providers.json` 中已启用的默认 Provider。指定其他：

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

每个 spec 对应一个垂直切片，用一个用户目标组织流程。

1. **走真实用户路径**：点击、输入、等待和确认都通过可见界面完成。不直接调用 renderer store、IPC handler 或 RuntimeAdapter。
2. **每条用例只有一个主要风险**：操作步骤可以重叠，验收结果不能重复。测试标题直接说明该用例负责证明的用户结果。
3. **按覆盖维度标记**：`@product` 覆盖产品交互、页面状态或持久化结果；`@agent` 覆盖 Runtime、上下文、工具调用、Agent Trace 或回复结果。一条用例可以同时包含两个标签。
4. **按执行类型标记**：`@local` 使用隔离测试数据且不发起远程请求；`@provider` 使用正式 Runtime 或真实 Provider。每条用例只能选择一种执行类型。
5. **验证 Agent Trace**：涉及 Agent 行为时，同时检查最终结果和与 Feature 有关的过程视图。工具调用、思考顺序和错误事件不能只依赖最终文本判断。
6. **控制真实请求数量**：确定性错误、数据合并、并发上限和取消传播由 L1/L2 覆盖。一个 Agent 用户闭环可以覆盖多个连续操作。
7. **保持 Runtime 合同**：需要两个 Runtime 共同满足的流程使用 `RUNTIMES` 参数化。差异由 `RuntimeCapabilities` 显式声明。

## 停止条件

- `@local` 用例默认总上限为 45 秒；`@provider` 用例默认总上限为 120 秒。
- 多轮对话、Schedule、Subtask 和文档工具可以通过 `test.setTimeout()` 声明更长的单用例总上限。单个断言的等待时间不得超过该总上限。
- 用户目标已经完成时立即通过；Agent 已结束但结果不符合预期时立即失败。
- 使用 `expectAssistantTextUntilSettled()` 的 Agent 流程连续 90 秒没有新增回复、过程事件或运行状态变化时立即失败。
- 每个用例结束后先正常关闭 Electron；5 秒内没有退出时强制结束 Electron 进程。失败现场保留在 `tests/.artifacts/e2e/`。
- 每条用例附带 `e2e-execution.json`，记录执行类型、总上限和实际耗时，供失败现场分析使用。

## Product 与 Agent

Product 和 Agent 是可重叠的覆盖维度。Agent E2E 可以通过真实 UI 完成配置、选择、授权或导航，再继续验证正式 Runtime 的结果。

- UI 操作属于主要风险时，通过界面执行并保留对应断言。
- UI 操作只用于准备环境时，由隔离 fixture 预置，避免重复拉长 Agent E2E。
- Product E2E 负责 Agent 主路径没有覆盖的确定性交互和分支，例如取消、删除、弹窗叠加、拖拽、导航和保存后重开。
- Agent E2E 选取关键产品主路径，继续验证 Runtime、Provider、Agent Trace 和用户最终结果。

常用组合：

| 标签 | 场景 |
|---|---|
| `@product @local` | 删除确认、设置保存、导航、拖拽和渲染 |
| `@product @provider` | 真实 Provider 目录获取等远程产品流程 |
| `@agent @provider` | 真实对话、工具和 Runtime 合同 |
| `@product @agent @provider` | 配置到正式 Query、权限、附件和子任务等完整 Agent 用户闭环 |

## 隔离

每个 test case 使用独立运行目录，预置 providers.json、memory-settings.json 和 mcp.json。Electron 进程目录、ZORA_HOME、默认会话目录和显式文件写入目录都位于该运行目录中。

`@local` 用例使用 fixture 生成的本地 Provider 配置。`@provider` 用例读取本机已启用的 Provider。两类用例都通过隔离 HOME 注入，不修改真实配置。

测试通过后清理运行目录。失败时保留截图、Renderer 日志、主进程日志和会话现场，复制的 Provider 凭据始终删除。下一次 E2E 启动时清理上一次遗留现场。

## 与 L1、L2 的分工

| 层 | 栈 | 职责 |
|---|---|---|
| L1 Unit | Vitest | 纯函数、单模块规则和确定性状态转换 |
| L2 Integration | Vitest + fake、临时目录或本地服务 | IPC 合同、持久化、Runtime 装配和跨模块协作 |
| L3 E2E | Playwright + 真实 Electron | 完整产品流程；需要 Agent 行为时继续经过正式 Runtime 和真实 Provider |

精确 SDK 时序语义由 L1/L2 覆盖。E2E 验证用户视角的结果和可见事件链。Provider 连接测试用例需要在同一配置上继续完成正式 Query，验证连接测试与实际运行一致。
