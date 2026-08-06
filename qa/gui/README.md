# L3 GUI Product Review

可重复的用户核心流程由 Playwright Electron E2E 执行，入口见 `tests/e2e/README.md`。Computer Use 用于视觉、文案、交互感受和探索式检查，两者共同构成产品级验证。

L3 GUI Product Review 是 Zora 的产品级发版巡检。它不是让人照着 checklist 手测，也不是 `bun run` 自己点击界面，而是由 Codex 读取这里的规则，再通过 Computer Use 接管 Electron GUI，模拟真实用户完成核心业务流。

## 核心原则

1. **真实代码路径**：启动 Electron，让应用读写真实的 `~/.zora` 结构，只把 `HOME` 替换为隔离目录。
2. **用户视角优先**：判断界面是否让真实用户走得通，而不只是 DOM 或函数返回值正确。
3. **少量高质量剧本**：优先覆盖核心业务流，不堆大量想象出来的 YAML case。
4. **问题沉淀为产品规则**：bug 修复后要提炼成产品规则与验收准则，吸收到 `product-rules.md` 或对应 case。
5. **报告即证据**：每次 GUI 巡检都要留下脱敏 `report.md`、截图和必要日志。
6. **密钥只短暂停留在隔离 HOME**：真实 SDK 测试可以把完整 Provider 复制进本次 `home/.zora`，但报告禁止记录 API key，测试结束必须清理测试 HOME。

## 触发方式

用户说以下任一句时，Codex 应进入 L3 GUI Product Review 模式：

- `开始发版前 L3 产品巡检`
- `跑一遍 GUI 发版巡检`
- `用 Computer Use 测 Zora 初始化流程`

执行顺序：

1. 读取 `release-smoke.md` 确认本次要跑的剧本。
2. 用 `bun run test:gui:init:local-provider` 启动隔离 HOME 的 Electron。如果不使用本机 Provider，则用 `bun run test:gui:init`。
3. 用 Computer Use 选择正在运行的 `Electron` 应用窗口。
4. 按 case 执行点击、输入、观察和判断。
5. 将报告写入 `tests/.artifacts/gui/runs/<run-id>/report.md`，报告只写 Provider 名称、模型和 baseUrl，不写 API key。
6. 将发现的问题归类为 `产品缺陷`、`体验问题`、`技术债`、`测试工具问题` 或 `规则待澄清`。
7. 测试完成后运行 `bun run test:gui:clean`，删除所有 GUI 测试 HOME；如果需要暂存现场排查，必须先明确告诉用户。

## 活跃文件

| 文件 | 作用 |
|------|------|
| `release-smoke.md` | 发版前必须跑的核心 GUI 剧本 |
| `product-rules.md` | 产品规则与验收准则，承接历史问题和 GUI 巡检沉淀 |
| `exploratory-charters.md` | Codex 探索式 GUI 测试任务 |
| `cases/init-model-awakening.md` | 初始化：模型配置 → 唤醒 → 主界面 |

## 与自动化 E2E 的关系

`bun run test:e2e` 自动完成界面点击、输入和可见结果断言，适合日常开发和 CI。`bun run test:e2e:live` 使用真实 Provider 运行同类用户流程，适合 SDK、Provider 和 Runtime 路径变更后的诊断。

Computer Use 保留用户体验判断能力，例如布局遮挡、反馈时机、文案理解成本和探索式操作。自动化 E2E 通过后，发版巡检仍可按风险选择对应的 Computer Use 剧本。

## 与 `bun run test:gui` 的关系

`bun run test:gui:init` 和 `bun run test:gui:init:local-provider` 只负责启动隔离环境，不会自动点击界面。真正的 L3 执行者是 Codex + Computer Use。

这点很重要：GUI 产品巡检不是一个普通 shell 命令，而是一段可观察、可判断、可沉淀的产品体验执行过程。

## 清理规则

测试期间，隔离 HOME 可能包含真实 Provider 和 API key：

```text
tests/.artifacts/gui/runs/<run-id>/home/.zora/providers.json
```

因此每次巡检完成后，Codex 必须主动提醒并默认执行：

```bash
bun run test:gui:clean
```

该命令删除所有 GUI 测试 `home/` 目录，保留报告、截图和日志。若某次失败需要保留现场，Codex 应先征得用户同意，并在报告中标注“测试 HOME 尚未清理”。
