# Pi Harness 评测与用户环境配置研究

日期：2026-08-27  
状态：时间点调研  
范围：Mario Zechner 的官方 Pi 仓库 `earendil-works/pi` 当前 `main`，提交 `ccfe79ed238674f760c986e3a61493aab794000a`；Terminal-Bench 与 Harbor 的官方资料。结论只基于官方源码、官方文档和基准官方仓库。

## 结论

Pi 当前已经有一套正式的、模型驱动的 Harness 评测包：[`packages/evals`](https://github.com/earendil-works/pi/tree/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals)。它使用真实 `AgentSession`、真实模型和 `vitest-evals`，可以对 prompts、工具、skills、模型或其他 Harness 配置做 baseline/candidate 配对比较。

当前默认评测**不会把某个用户已有的 Pi 工作环境整体带入**。每次运行都创建新的临时 workspace 和 agent directory，使用空的内存 settings，并在开始时断言没有已加载 extension。用户的全局/项目 settings、已有 skills、extensions、上下文文件和真实仓库状态因此不进入默认分数。

存在一个重要例外：评测的 `ModelRuntime` 复用 Pi 的正常鉴权和模型配置来源。`PI_PROVIDER`、`PI_MODEL`、`auth.json`、环境变量，以及默认 `models.json` 中的自定义 Provider / 模型，会影响实际调用的模型和接入端点。这些输入当前用于让评测可运行，并未作为 baseline/candidate 的独立变量或报告字段。

因此，适合把评测结果拆成两个不可混合的口径：

| 口径 | 回答的问题 | 环境处理 | 输出 |
| --- | --- | --- | --- |
| 发布基线评测 | Pi 某版本的默认 Harness 在固定任务与固定运行条件下表现如何 | 固定模型、系统提示、工具版本、容器和任务快照；隔离用户资源 | 可横向比较的基线分数 |
| 配置增量评测 | 某个配置 profile 相对该发布基线带来什么收益、成本或故障 | 复制并冻结该 profile 到临时目录，再用相同任务做配对运行 | profile 对基线的差值，不纳入公共排行榜 |
| 配置兼容性检查 | profile 能否加载，是否引入工具冲突、权限、资源发现或协议错误 | 使用最小隔离 fixture，覆盖 settings / extension / skill / context 的装配 | 通过、失败和可诊断原因 |

把真实用户目录直接作为公共 benchmark 的运行目录会破坏可复现性，也可能让本地凭据、缓存、全局指令和仓库未提交状态进入结果。更合适的方式是将用户配置导出为受版本控制或有内容哈希的 profile，在隔离环境中复现它。

## 1. Pi 当前的评测体系

### 1.1 固定行为与协议回归

Pi 的常规 `./test.sh` 会把 `HOME`、`USERPROFILE`、临时目录、npm 配置和 git 配置指向新建的临时根目录，并以空环境运行测试；同时设置 `PI_NO_LOCAL_LLM=1`。这层用于确定性单元、集成和协议回归，默认不调用用户 API key 或本地模型。[`test.sh`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/test.sh#L1-L79)

该层验证代码合同，不产生模型能力分数。

### 1.2 模型驱动的行为评测

`@earendil-works/pi-evals` 将真实 `AgentSession` 接入 `vitest-evals`。官方 README 将其定义为行为型、模型驱动的 Pi workflow 检查，并明确它可比较 prompts、tools、skills、models 和其他 Harness 配置。[`packages/evals/README.md`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/README.md#L1-L5)

运行入口为仓库根目录的 `npm run eval`。评测可用命令行或 `PI_PROVIDER` / `PI_MODEL` 指定默认模型，也可以由单个 Harness 显式指定模型；模型鉴权来自正常 `ModelRuntime`，包括 Pi 订阅凭据和 Provider API key 环境变量。[`README.md`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/README.md#L7-L34)

评测 Harness 记录以下运行数据：

- 最终输出和规范化的消息、工具调用、工具结果 trace。
- 输入、输出和总 token，工具调用数量，缓存 token，以及有定价信息时的估算成本。
- 总耗时。
- 原生 Pi session JSONL 快照，便于回放和人工审计。

证据见 [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/pi-harness.ts#L46-L87) 与 [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/pi-harness.ts#L179-L243)。

当前 `main` 的评测入口只收集 `src/**/*.eval.ts`，单次 case 的 timeout 为 120 秒。[`vitest.config.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/vitest.config.ts#L1-L20) 当前仓库只包含两个行为评测文件：基础 prompt smoke test 与 extension authoring test。此结论仅描述上述提交的已跟踪文件，不表示未来不会增加任务集。

### 1.3 基线与候选配置的比较

Pi 提供 `evalHarnessTable(...)`。同一个输入按照 repetition 组成 group，baseline 与每个 candidate 配对。重复次数缺省为 1，调用方需要主动提高 repetitions。[`harness-table.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/vitest-evals/harness-table.ts#L116-L192)

官方要求比较型 suite 使用确定性或模型 judge 记录 correctness，并将 `judgeThreshold` 设为 `null`，使低分作为观测保留，而非直接导致 Vitest 失败。报告对每个匹配输入和 repetition 计算 candidate 相对 baseline 的 pass-rate lift，并独立报告 token、延迟和成本的配对差值。[`README.md`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/README.md#L104-L150)

当前唯一的比较型行为评测是 extension authoring workflow：baseline 移除默认系统提示中的 Pi guidelines / documentation，candidate 保留默认系统提示；任务要求 Agent 在隔离 workspace 创建 `.pi/extensions/hello.ts`、reload，并成功调用生成的 `hello` 工具。judge 同时检查源码 import、extension loader 错误、工具注册、工具 trace 和最终输出。[`extensions.eval.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/extensions.eval.ts#L18-L139)

这说明 Pi 已经将 Harness 内的系统提示和资源工作流作为可评测对象。它尚未提供一个内置的用户 profile 发现或 profile matrix。

## 2. 默认评测与用户环境的边界

### 2.1 默认运行环境刻意隔离

每次 `createPiCodingAgentHarness()` 运行执行以下操作：

1. 创建新的临时根目录，以及其中的 `workspace` 和 `agent` 子目录。
2. 将这两个目录分别作为 session 的 `cwd` 和 `agentDir`。
3. 注入 `SettingsManager.inMemory()`。
4. 若 session 初始加载了任意 extension，则直接抛出 `Expected an isolated eval session to start without extensions.`。
5. 结束前保存 session JSONL artifact，然后删除临时根目录。

实现见 [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/pi-harness.ts#L109-L243)。

因此，默认评测排除了以下真实环境因素：

| 环境输入 | 默认 Pi eval 的处理 | 依据 |
| --- | --- | --- |
| 全局与项目 `settings.json` | 排除。session 使用空内存 settings，不读取用户或任务仓库中的文件 | [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/pi-harness.ts#L122-L151) |
| 已安装的全局 / 项目 extensions | 排除。初始已加载 extension 会使评测失败 | [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/pi-harness.ts#L164-L168) |
| 已发现的 skills、prompts、`AGENTS.md` 等上下文 | 排除。它们依赖 session 的 `cwd` 与 `agentDir` 发现，此处两者均为空临时目录 | [SDK directories](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/coding-agent/docs/sdk.md#L335-L365) |
| 真实目标仓库、git 历史、缓存、工作区未提交状态 | 排除。`cwd` 是新建空目录 | [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/pi-harness.ts#L122-L141) |
| 模型鉴权与默认自定义模型配置 | 保留在 evaluator 进程侧。Harness 调用无参 `ModelRuntime.create()`，其默认读取正常 Pi agent directory 的 `auth.json` 和 `models.json` | [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/evals/src/pi-harness.ts#L117-L120)，[`model-runtime.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/coding-agent/src/core/model-runtime.ts#L172-L216) |

最后一项需要单独记录。它可能影响 Provider、模型 ID、base URL、接入能力和成本，但它不应暴露密钥，也不应被误认为包含完整个人 profile。

### 2.2 Pi 的真实配置面

真实 Pi session 的 `DefaultResourceLoader` 以 `cwd` 和 `agentDir` 为边界发现资源：

- `cwd` 发现项目 extensions、`.pi/skills`、`.agents/skills`、项目 prompts 和从当前目录向上遍历的 `AGENTS.md`。
- `agentDir` 发现全局 extensions、skills、prompts、全局 `AGENTS.md`、settings、custom models、credentials 和 session。

官方 SDK 文档列出了完整目录归属。[`sdk.md`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/coding-agent/docs/sdk.md#L335-L365) SettingsManager 还会将全局 `settings.json` 与项目 `.pi/settings.json` 深度合并，项目覆盖全局。[`settings-manager.ts`](https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/packages/coding-agent/src/core/settings-manager.ts#L298-L347)

因此，用户实际使用的 Harness 可表示为：

```text
Pi release + model/provider access + settings + tools/extensions + skills/context + repo/task state + host policy
```

当前官方默认 eval 固定或清空后五项中的大部分，只保留模型接入作为执行前提。公开 baseline 不能直接代表某位用户完整 profile 的实际效果。

## 3. 公开基准的处理方式

公开 benchmark 的核心目标是跨 Agent 可比性，因此会固定任务和执行环境，而不加载每位用户的本地配置。

- [Terminal-Bench 官方仓库](https://github.com/harbor-framework/terminal-bench-1#core-components)将 benchmark 定义为任务数据集加连接模型与 terminal sandbox 的 execution harness；每个任务有 instruction、验证 test script 和 oracle solution。
- [Harbor 官方仓库](https://github.com/harbor-framework/harbor#example-running-terminal-bench-20)是 Terminal-Bench 2.0 的官方 harness，命令显式选择 dataset、agent、model 和 Docker / 云端环境。

这些体系允许被测 Agent 适配器具有自己的固定配置，因此不同 Harness 可以被比较。个人目录的历史、私有 skills、缓存或凭据不属于 task specification。它们进入运行后，分数应解释为某个固定 profile 的实验结果，不再是公共 leaderboard 的纯产品分数。

截至本次检查的 Pi `ccfe79e` 源码，未发现 Pi 对 SWE-Bench、Terminal-Bench、Aider Polyglot、OSWorld、WebArena 或 GAIA 的官方评测适配、任务集或已发布成绩。检索仅在一个 session fixture 文本中发现 `SWE-Bench` 字符串。这个“未发现”结论只覆盖该版本仓库内容，不覆盖第三方 fork、用户脚本或未来发布。

## 4. 建议的体系化方案

### 4.1 配置 profile 的定义

profile 应明确列出并内容寻址以下输入，不使用真实用户目录作为运行目录：

| 类别 | 建议冻结的内容 | 记录方式 |
| --- | --- | --- |
| Harness 版本 | Pi package version、commit、系统提示哈希、内置工具版本 | 不可变版本和 hash |
| 模型接入 | provider、model、协议、base URL 的非敏感标识、采样与预算 | 去密钥 manifest |
| Pi 行为配置 | global / project settings 的有效合并结果 | canonical JSON hash |
| 扩展与 skills | 文件内容、依赖锁定、加载顺序、启用状态 | source hash 和 load manifest |
| 上下文 | `AGENTS.md` / `SYSTEM.md` / prompt templates 的快照 | source hash 和路径角色 |
| 任务环境 | 仓库 commit、初始工作树、容器镜像、可用命令、网络政策 | image digest 与 task revision |
| 安全边界 | 文件、网络、凭据和执行权限 | policy manifest |

认证只应以 credential presence、provider 类型或 secret reference 标记记录，不能把 token、API key 或真实 `auth.json` 保存到 artifact。

### 4.2 两条评测通道

**发布基线通道**使用空 profile。它适合版本发布门禁、回归比较和公共报告。环境、任务、模型选择、预算、并发和 repetitions 必须锁定；对于概率性模型，重复次数必须大于 1，报告通过率及其样本数，不能只报告一次运行的胜负。

**配置增量通道**从同一发布基线复制 profile 到临时 `agentDir` 和临时 workspace，并运行相同的输入、评判器、模型与任务镜像。对每个配置仅改变一个已声明的 treatment，例如某 skill、extension 版本、context 文件或 settings 组。结果至少包含：

- correctness pass-rate 相对基线的差值；
- token、延迟、估算成本的配对差值；
- extension / skill 加载诊断、工具 trace 和 session artifact；
- profile manifest hash、任务 revision、模型接入标识与运行时间。

完整 profile 与基线的差值可以评估整套个人配置，但无法归因到单个组件。需要归因时应在 profile 基础上逐项移除或替换 component，采用 matched baseline/candidate 矩阵。

### 4.3 三层门禁

1. **加载与安全**：在不调用模型的 fixture 中验证 settings 合并、资源发现、extension 冲突、工具 schema、权限和缺失依赖。
2. **行为**：对关键用户任务运行真实 AgentSession，使用确定性 judge 或经过校准的 model judge，保存 trace。
3. **标准化能力**：在冻结的 benchmark/task slice 上比较 release baseline 与 profile variant。任何包含私有上下文或本地能力的结果标记为 profile-scoped，避免与默认 Harness 分数并列。

## 5. 局限

1. Pi 的 `packages/evals` 位于本次检查的 `main`，包版本字段为 `0.84.3`。本文没有确认它已包含在每个已发布 npm 版本中。
2. 当前公开 eval 的任务数量很小，主要覆盖无工具事实问答和在临时工作区编写 / 加载一个 extension。它不足以代替多仓库修复、长上下文、权限、网络、复杂工具链和真实项目状态评测。
3. `ModelRuntime.create()` 使用正常默认模型 / 鉴权来源，可能引入 evaluator 本地的自定义 Provider 配置。公开结果应把非敏感 model runtime manifest 固化，否则相同 `provider/model` 标签不一定表示相同 endpoint 或能力。
4. Terminal-Bench 与 Harbor 说明了标准化 benchmark 的环境原则，但它们没有为 Pi 提供官方 adapter 或 Pi 的公开成绩。本报告没有据此推断 Pi 在这些 benchmark 上的能力数值。
