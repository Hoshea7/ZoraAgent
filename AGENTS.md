1. 你称呼我"天~"
2. 想全面，做仔细

编码核心原则思想，一定要遵守：
1、不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。
2、选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。
3、系统分层长。先跑通一个最小的端到端版本，再往上加东西。绝不为了未完成的复杂度拆掉能跑的东西。
4、组件保持模块化，关注点分离。
5、优先用成熟的、有人维护的库。没有明确理由别自己重写。
6、先翻项目里已有的依赖能做什么，再考虑加新包或自己写。别上来就假设库里没有。
7、架构决策往长了做。不接受"先这样以后再换"的临时方案。
8、先看成熟产品怎么解决同一个问题，用已验证的模式，别从零发明。

在设计和执行代码的时候，应该优先参考官方文档：
- 官方文档本地镜像：`claude_agent_sdk_ref/`（存在时使用）
- Proma项目参考：/Users/bytedance/Desktop/03-code/github_ref/Proma

## 测试体系

| 层级 | 目标 | 执行方式 |
|------|------|----------|
| L1 Unit | 纯函数和单模块逻辑正确 | `bun run test:unit` |
| L2 Integration | 多模块协作正确，使用 mock/临时目录 | `bun run test:integration` |
| L3 E2E | 真实 Electron 应用 + 真实 Provider + 真实 Agent 行为 | `bun run test:e2e` |
| Live SDK | 真实 Provider/SDK 连通性诊断 | `bun run test:live` |

L1 和 L2 用 Vitest，L3 用 Playwright 启动 Electron。Live SDK 是诊断工具，不替代 L3。

### 测试文件位置约定

| 被测内容 | 测试资产 |
|----------|----------|
| `src/main/xxx.ts` | `tests/unit/main/xxx.test.ts` |
| `src/renderer/utils/xxx.ts` | `tests/unit/renderer/utils/xxx.test.ts` |
| 模块间交互 | `tests/integration/xxx.test.ts` |
| 真实 SDK 诊断 | `tests/live/xxx.test.ts` |
| 端到端用户流程 | `tests/e2e/xxx.spec.ts` |

### 何时必须同步测试

| 变更类型 | 必须做什么 |
|----------|-----------|
| 新增纯函数/工具函数 | 增加 L1 单元测试 |
| 新增主进程/渲染进程模块协作 | 增加 L2 集成测试 |
| 涉及 Provider/SDK/Agent 调用 | 跑 `bun run test:live`，必要时补 live 诊断测试 |
| 新增 Feature 或用户可感知功能变化 | 同步构建 L3 E2E 测试 |
| Bug 修复 | 增加 L1/L2 回归断言；如涉及用户流程，补 E2E |

### PR 提交前自查清单

- [ ] 新增/修改的代码有对应 L1/L2 测试覆盖
- [ ] `bun run test` 全绿
- [ ] `bun run typecheck` 通过
- [ ] 如涉及用户流程，`bun run test:e2e` 通过
- [ ] 如涉及 SDK 调用路径变更，`bun run test:live` 通过
- [ ] 如修复 Bug，已把问题沉淀为测试断言

## E2E 测试规则

E2E 随 Feature 一起构建，不事后补。每个 Feature 完成时同步产出对应的 E2E 测试用例。

### 核心原则

1. **真实 Provider，不 mock**。Zora 是 Agent 产品，mock 掉模型等于什么都没测。E2E 默认读取本机 `~/.zora/providers.json` 中已启用的默认 Provider，通过隔离 HOME 注入。

2. **模拟真实用户交互**。测试通过可见界面操作（点击、输入、等待），不直接调用 renderer store、IPC handler 或 RuntimeAdapter。测试应该像一个人坐在电脑前用 Zora 一样。

3. **验证 Agent 真实行为，不停留在 UI 渲染**。Agent 产品的 E2E 要验证的是 Agent 做了正确的事，不只是界面显示了正确的组件。具体来说：
   - 如果 Feature 涉及工具调用，设计一个用户流程让 Agent 真实触发该工具，验证工具被执行且结果正确。比如让 Agent 读一个文件，验证 Agent Trace 中出现 Read 工具调用，且回复中包含文件内容。
   - 如果 Feature 涉及 Agent 的思考/规划能力，验证 thinking 区域先于正文出现，且内容与任务相关。
   - 如果 Feature 涉及权限确认，设计流程让 Agent 触发需要权限的操作，验证权限弹层出现，用户操作后 Agent 继续。
   - 如果 Feature 涉及运行时切换，验证切换后上下文保持，新 Runtime 能继续对话。

4. **看 Agent Trace**。测试不仅要看最终回复，还要检查 Agent 的中间过程。通过 `.ai-process-content` 等 UI 区域验证工具调用、thinking 步骤、事件链顺序。

5. **断言要验证结果，不只验证状态**。比如不只是"按钮可点击"，而是"Agent 回复中包含文件名"；不只是"消息已发送"，而是"Agent 触发了 Read 工具并返回了文件内容"。

### 测试结构

```typescript
import { expect, test } from "./support/electron-fixture";

test("用户让 Agent 读文件并回复内容", async ({ page }) => {
  test.setTimeout(120_000); // 真实模型响应需要时间

  // 1. 模拟用户输入
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("读取 package.json 文件，告诉我项目名称");
  await composer.press("Enter");

  // 2. 验证 Agent 中间过程（Agent Trace）
  const processView = page.locator(".ai-process-content");
  await expect(processView).toContainText("Read", { timeout: 60_000 });

  // 3. 验证 Agent 最终结果
  const assistantBody = page.locator(".ai-message-content").last();
  await expect(assistantBody).toContainText(/zora/i, { timeout: 60_000 });
});
```

### timeout 设置

真实模型响应需要时间。单次 E2E test case 的 timeout 默认 120s（在 `playwright.config.ts` 中配置）。如果测试涉及多轮对话或长任务，用 `test.setTimeout()` 单独调大。

### 隔离与清理

每个 test case 拿到独立的 temp HOME 目录，预配置 providers.json / memory-settings.json / mcp.json。测试通过后自动清理，失败时保留现场（截图 + renderer 日志在 `tests/.artifacts/e2e/runs/` 下）。

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default mattpocock/skills label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
