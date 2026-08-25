# Proma 单次输出预算与长任务机制研究

日期：2026-08-25
范围：本地参考仓库 `/Users/bytedance/Desktop/03-code/github_ref/Proma` 的当前源码、锁定依赖、发布说明与 Git 历史。未使用第三方文章或未经验证的 Provider 文档。

## 结论

Proma 的 Pi Agent 没有设置一个所有任务共用的 16K 级单次输出预算。它将模型注册时的 `maxTokens` 作为模型能力配置处理：目录可用时采用目录值，目录缺失时回退到 **64,000**；少数已验证的模型或接入点使用 **128,000**。当前 UI/设置仅支持推理深度、最大轮次和美元预算，没有提供用户可调的 Agent 单次输出 token 设置。

Proma 的取值分层如下：

| 场景 | 当前值 | 配置位置 | 说明 |
| --- | ---: | --- | --- |
| Pi 通用目录缺失回退 | 64,000 | `pi-model-registry.ts` | 未在源码或提交说明中找到该数值的选型依据。 |
| 火山方舟 `glm-5.2` | 128,000 | `pi-model-registry.ts` | 该接入点明确低于 Pi 智谱目录中的 131,072，故做 Provider 兼容修正。 |
| Codex 补齐项 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` | 128,000 | `pi-model-registry.ts` | Proma 的补齐 catalog 项使用此值。若 Pi Runtime 已有该模型，`buildCodexModel()` 优先采用 Runtime 返回的原模型，不能据此推断所有 Codex 请求均为 128K。 |
| 标题生成 | 40 | `pi-codex-title-generator.ts` | 独立、短输出的后台请求，不属于 Agent 主任务预算。 |
| 连通性检测、普通 Chat 标题等 | 8、10、50、512 | 各自的探测或普通 Chat adapter | 不属于 Pi Agent 主任务预算，不能据此设置 Agent 上限。 |

对 Zora 的直接启示：当前将 Productivity Profile 的 `maxOutputTokens` 固定为 16,384，会把 reasoning 与最终正文放进同一个较小硬上限。对于多文档阅读、高推理与工具链任务，这个数值不足以覆盖一次完整的“推理 + 成文”响应。若以 Proma 的现行 Pi 方案作为参考，**64K 应作为 Zora 的 Pi Agent 默认单次输出预算候选值**；可确认 Provider 支持 128K 的具体模型，再使用模型级 128K 上限。不要把 128K 作为所有 Provider 的全局值。

这是一项基于参考实现和本次长度截断现场的工程判断，不是跨厂商通用标准。最终值仍应以 Zora 实际 Provider 对具体模型和 API 路由接受的 `max_tokens`/`max_output_tokens` 为准。

## 1. 研究版本与证据边界

检查时 Proma 工作树无未提交改动，HEAD 为：

```text
447169c791c4421c3e9618a45e1f2f3879b08282
2026-08-06T22:24:30+08:00
支持channel ID
```

当前 Electron 包版本为 `0.17.26`，Pi 相关依赖统一锁定为 `0.82.1`：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/package.json:3`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/package.json:45-47`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/package.json:36-45`

Proma 在 2026-08-08 已迁移为 Pi-only Agent Runtime。因此本笔记的“Agent”只指当前 Pi Agent 路径，不把普通 Chat、标题生成或历史 Claude Runtime 的参数混为一谈：

- 提交 `ebfd3a58`，`refactor: migrate agent runtime to Pi-only (#1498)`。

## 2. Pi Agent 的 `maxTokens` 解析规则

### 2.1 当前注册逻辑

`resolvePiModelDefaults()` 对普通 Provider 的规则为：

```ts
maxTokens: isVolcengineGlm52
  ? VOLCENGINE_GLM_52_MAX_TOKENS
  : (catalogModel?.maxTokens ?? DEFAULT_MAX_TOKENS)
```

随后 `buildModel()` 会把已解析的 `maxTokens` 写入 Pi 注册模型对象，交给 Pi Runtime 发起请求：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:537-552`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:751-772`

因此，Proma 的优先级为：

```text
火山方舟 glm-5.2 的接入点修正
  > Pi catalog 对该模型声明的 maxTokens
  > 64,000 通用回退值
```

`maxTokens` 和 `contextWindow` 是不同字段。前者约束一次模型响应可产生的 token，后者描述整轮请求可容纳的历史、工具结果与输出总空间。Proma 同时把两者传入 Pi 模型注册，未使用“按 contextWindow 的固定比例”计算 maxTokens 的策略。

### 2.2 64K 回退值

Proma 当前代码定义：

```ts
const DEFAULT_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_TOKENS = 64_000
```

来源：`/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:52-57`。

该值在 2026-07-17 Pi Runtime 合并时首次引入，提交 `1b89bbd6`。提交说明描述了 Pi Runtime 集成和工具接入，未提供 64K 的性能测试、成本预算或 Provider 限制依据；当前代码注释也未解释这个默认值。对此，项目内的选型理由为**未发现**。

### 2.3 128K 的模型级例外

火山方舟 `glm-5.2` 的例外来自明确的接入限制：Pi 智谱目录声明 131,072，但火山方舟兼容端点的上限为 128,000。该修正于 2026-07-20 提交 `d79d1b99`（`fix: cap Volcengine GLM-5.2 output tokens (#1206)`）加入：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:54-57`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:543-552`

Proma 对三个补齐的 Codex GPT-5.6 模型项也设置了 `maxTokens: 128_000`：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:252-290`

这不表示所有 Codex 模型都被产品层统一改写为 128K。`buildCodexModel()` 优先直接从 Pi 内置 Codex Runtime 获取模型；只有目录缺失时才使用 Proma 的补齐项：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:661-689`

### 2.4 历史 Claude 的 64K 不适用于当前 Pi Agent

`v0.16.8` 发布说明记录过历史 Claude 路径向真实 Claude 模型注入 `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` 的修复。该运行时已在 Pi-only 迁移中移除；当前主线源码中不存在该环境变量的注入逻辑：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/release-notes/v0.16.8.md:13`
- 提交 `ebfd3a58`。

它能说明 Proma 曾把 64K 用作 Claude Runtime 的输出上限，但不能作为当前 Pi 路径的另一层上限。

## 3. 用户能否配置输出预算

Proma 当前应用设置提供：

- 推理模式与推理深度；
- 每次任务的最大美元预算；
- 最大 Agent 轮次，`0` 或未设置时使用 SDK 默认行为。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/types/settings.ts:311-320`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1322-1324`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-runtime-guards.ts:1-91`

未发现 `agentMaxOutputTokens`、任务档位输出预算或将 UI 值覆盖 Pi 模型 `maxTokens` 的设置项。也未发现 Profile 将 reasoning depth 与单次输出额度绑定的逻辑。Proma 的主 Agent 预算属于模型注册能力，用户可见的资源保护采用轮次和费用两个维度。

## 4. Thinking、输出上限与本次问题的关系

Proma 将 reasoning capability 和 thinking level map 注册到 Pi 模型，但仍将 `maxTokens` 单独保留在模型能力中：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:76-112`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:537-552`

参考项目同时存在一个普通 Anthropic Chat adapter。其注释明确说，`max_tokens` 是“思考 + 回答”的总硬上限；开启 adaptive/effort 推理时该 adapter 配置 32,000，关闭 thinking 时为 8,192，manual thinking 时为 `16,384 + 16,384`。它没有用于当前 Pi Agent，但说明 Proma 在同一产品内已经将 reasoning 与最终正文视为同一输出池：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/core/src/providers/anthropic-adapter.ts:311-327`

因此，Zora 现场中 16,384 tokens 被 GLM-5.3 的 reasoning 消耗而没有形成正文，符合这类 API 的资源语义。把 reasoning 设置为 `high` 后仍固定 16K，无法保证为最终答复留出额度。

## 5. 长任务与 compaction

### 5.1 Proma 的上下文策略

Proma 在 Pi SettingsManager 中启用自动 compaction。它保留窗口的 20% 作为 `reserveTokens`，因此在约 80% context window 时开始压缩：

```text
reserveTokens = ceil(contextWindow × 0.2)
threshold = contextWindow - reserveTokens
```

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/utils/pi-compaction.ts:1-21`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1315-1344`

它还提供 `CompactContext` 工具，要求写入 durable handoff 后压缩并自动继续原始任务；产品层最多执行 20 次这种自动 continuation：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:97`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:669-689`

### 5.2 compaction 不能替代输出预算

上下文压缩处理的是输入历史空间。它降低后续请求因历史、工具结果过大而无法生成的风险，无法增加本次请求已经设定的 `maxTokens`。

Proma 0.82.1 对 `stopReason: "length"` 的自动恢复条件也较窄：只有 `output === 0` 且输入加缓存读取达到 context window 的 99% 时，才把该响应视为上下文溢出并延迟产品终态，等待 Pi native recovery：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:702-726`

它不会将“已消耗完整 16K 输出预算”的情况识别为 context overflow。这与 Zora 本次现场相符：提高 `maxOutputTokens` 是直接解决输出截断的动作；升级 Pi 的 recoverable-length 机制和保留自动 compaction 用于处理另一类上下文压力。

## 6. 适用于 Zora 的取值建议

### 6.1 建议的默认策略

| 层级 | 建议值 | 适用范围 | 依据 |
| --- | ---: | --- | --- |
| Provider/模型能力上限 | 由 Provider 模型目录或经连接测试确认的最大值 | 每个模型 | 避免把一个模型的额度施加给不支持该额度的端点。Proma 对火山方舟 GLM-5.2 的 128K 修正采用此方式。 |
| Pi Agent 默认请求上限 | 64,000 | 有工具调用、长文档、研究、编码等 Productivity 任务 | 与 Proma 的未知模型回退值一致，显著高于当前 16,384，能为 reasoning 和最终正文共同留出空间。 |
| 模型级长任务上限 | 128,000 | 已验证支持 128K 的模型与接入点 | Proma 对火山方舟 GLM-5.2 与补齐的 Codex GPT-5.6 模型采用 128K。 |
| 短后台任务 | 单独设置低值，例如 40 | 标题、连通性探测、结构化短标签 | Proma 对标题生成设为 40，避免短任务占用 Agent 级预算。 |

对当前 Zora GLM-5.3 问题，建议先把 Productivity Profile 的单次输出预算从 **16,384 提升到 64,000**，同时保留 Provider 级 `min(profile cap, model cap)` 约束。待该 GLM-5.3 接入点的实际 maximum output 通过连接测试或官方契约确认后，再决定是否将其模型能力上限设为 128,000。

### 6.2 不建议的策略

- 不建议继续让所有推理等级共用 16,384，尤其是 `high` 与多文档任务。
- 不建议把 128,000 直接写成所有模型的全局默认值。Proma 的 128K 都带有具体模型或接入点范围。
- 不建议将 context compaction 当成单次输出不足的补救措施。二者处理的资源维度不同。
- 不建议把 token 数直接暴露给普通用户作为主要控制项。Proma 的现有界面也未暴露该值；Zora 可保留内部模型配置，并在需要时仅提供“标准 / 长任务”这类产品语义的选择。

### 6.3 验证条件

在提交配置调整前，应至少验证：

1. GLM-5.3 当前接入点接受 64K 请求，不返回参数范围错误。
2. 高推理、多工具、多文档用例能在一轮中形成最终正文，且不会再次以 `stopReason: "length"` 在恰好 64K 处中止。
3. 若准备使用 128K，先验证该接入点的最大输出契约。Proma 的 GLM-5.2 经验不能自动外推到 GLM-5.3。
4. 在较长上下文下验证 Pi compaction 和 `length` 恢复。它们应由 Runtime 事件驱动，不以产品层重放原始用户请求的方式恢复，避免重复执行副作用工具。

## 7. 未发现的依据

本次未在 Proma 当前源码、发布说明、计划文档和引入 64K 的提交信息中找到以下内容：

- 通用 64K 回退值的基准测试、延迟目标、成本目标或正式设计说明；
- 将 `maxTokens` 与 reasoning level 绑定的产品策略；
- 所有 Provider 共用 128K 的策略；
- 让用户直接配置 Agent 单次输出 token 的 UI 设计。

因此，64K 可以作为对齐 Proma 现行实现的合理默认候选值，但不能表述为项目已验证的唯一最优值。
