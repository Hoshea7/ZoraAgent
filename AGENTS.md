1. 你称呼我"天~"
2. 想全面，做仔细

编码核心原则思想，一定要遵守：
1、不保留向后兼容（除非是因版本升级特殊指定的）。过时的直接删，别加兼容层、别写migration、别留fallback。
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

架构决策：
1. 后续我们会切换以Pi为核心runtime,针对Pi进行优化。Claude这条线先保持兼容即可。

## 测试体系

| 层级 | 目标 | 执行方式 |
|------|------|----------|
| L1 Unit | 验证纯函数、单模块和确定性状态转换 | `bun run test:unit` |
| L2 Integration | 验证多个模块之间的接口与协作 | `bun run test:integration` |
| L3 E2E | 验证真实 Electron 应用中的完整用户流程 | `bun run test:e2e` |

L1 和 L2 使用 Vitest。L3 使用 Playwright 启动 Electron，并调用真实 Provider 和正式 Agent Runtime。

### 分层边界

- L1 不启动 Electron，不访问网络，不读写真实用户目录。外部依赖通过 stub 或 fake 注入。
- L2 可以使用临时目录、本地测试服务和模块级 fake。它覆盖 IPC 合同、持久化、Runtime 装配和跨模块错误传播，不调用真实 Provider。
- L3 从可见界面开始，经过 preload、IPC、主进程、正式 Runtime 和真实 Provider，再回到可见界面或持久化结果。测试不得直接调用 renderer store、IPC handler 或 RuntimeAdapter。
- 同一个风险只保留一个主要测试层。纯计算和失败分支优先放在 L1，模块协作放在 L2，只有真实用户闭环与真实模型行为放在 L3。

### 测试文件位置约定

| 被测内容 | 测试资产 |
|----------|----------|
| `src/main/xxx.ts` | `tests/unit/main/xxx.test.ts` |
| `src/renderer/utils/xxx.ts` | `tests/unit/renderer/utils/xxx.test.ts` |
| 模块间交互 | `tests/integration/xxx.test.ts` |
| 端到端用户流程 | `tests/e2e/xxx.spec.ts` |

### 何时必须同步测试

| 变更类型 | 必须做什么 |
|----------|-----------|
| 新增纯函数/工具函数 | 增加 L1 单元测试 |
| 新增主进程/渲染进程模块协作 | 增加 L2 集成测试 |
| 修改 Provider、协议或 Runtime 装配 | 增加 L1/L2 回归断言，并验证对应 L3 用户闭环 |
| 新增 Feature 或用户可感知功能变化 | 与实现同步设计 L3 E2E |
| Bug 修复 | 在能够稳定复现问题的最低层增加回归断言；涉及真实用户闭环时补 L3 |

### PR 提交前自查清单

- [ ] 新增或修改的规则有对应 L1/L2 测试覆盖
- [ ] `bun run test:unit` 通过
- [ ] `bun run test:integration` 通过
- [ ] `bun run typecheck` 通过
- [ ] 用户可感知功能对应的 `bun run test:e2e` 通过
- [ ] Bug 已转化为稳定的回归断言

## E2E 测试规则

E2E 与 Feature 同步设计。用例按用户目标划分，每条只承担一个无法由 L1 或 L2 证明的产品风险。

### 核心原则

1. **使用真实 Provider**。E2E 默认读取本机 `~/.zora/providers.json` 中已启用的 Provider，再复制到单用例隔离目录。缺少可用配置时直接失败。

2. **模拟真实用户交互**。测试通过可见界面点击、输入和等待，不绕过产品边界调用内部接口。

3. **验证 Agent 真实行为**。断言覆盖最终结果和与 Feature 有关的 Agent Trace：
   - 如果 Feature 涉及工具调用，设计一个用户流程让 Agent 真实触发该工具，验证工具被执行且结果正确。比如让 Agent 读一个文件，验证 Agent Trace 中出现 Read 工具调用，且回复中包含文件内容。
   - 如果 Feature 涉及 Agent 的思考/规划能力，验证 thinking 区域先于正文出现，且内容与任务相关。
   - 如果 Feature 涉及权限确认，设计流程让 Agent 触发需要权限的操作，验证权限弹层出现，用户操作后 Agent 继续。
   - 如果 Feature 涉及运行时切换，验证切换后上下文保持，新 Runtime 能继续对话。

4. **验证结果**。按钮可点击、消息已发送和 HTTP 请求成功不能单独作为通过条件。断言应落在用户获得的结果、Agent 行为或持久化状态上。

5. **控制真实请求数量**。一个用户闭环可以覆盖多个连续操作。确定性错误、并发调度、取消传播和数据合并由 L1/L2 覆盖，不为这些分支重复消耗真实模型请求。

6. **连接测试与正式运行保持一致**。模型连接测试必须使用正式 Runtime 的目标解析、上下文构造、协议适配和流解析。Provider Feature 的 L3 需要在同一配置上先完成连接测试，再发起正式用户 Query 并获得有效回复。

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

每个 test case 使用独立的运行目录。HOME、USERPROFILE、ZORA_HOME、Electron 工作目录、Workspace、Session、临时文件和日志都必须位于该目录内。任何新增写入路径都要先通过路径边界校验。

测试通过后删除该用例目录。失败时保留截图、Renderer 日志、主进程日志和会话现场到 `tests/.artifacts/e2e/`，复制的 Provider 凭据必须删除。下一次启动 E2E 时清理上一次遗留现场。测试不得修改仓库根目录或真实用户目录。
