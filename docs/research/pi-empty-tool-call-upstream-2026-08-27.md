# Pi 空工具调用上游研究

日期：2026-08-27

范围：`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent` 的最新稳定版本与当前上游源码；Anthropic Messages 工具调用协议；火山方舟 Agent Plan 的公开接入资料。结论只使用官方仓库、官方 API 文档和 npm 官方 registry。

## 结论

1. npm 官方 registry 当前对三个包返回的 `latest` 均为 `0.84.3`，发布时间均为 2026-08-24。Zora 当前锁定的 `0.84.2` 落后一个补丁版本。Pi 的 [`v0.84.3` 发布说明](https://github.com/earendil-works/pi/releases/tag/v0.84.3)没有空 `toolCall.id`、空 `toolCall.name`、空 `tool_use_id` 或 ghost tool call 修复。
2. `v0.84.3` 和截至本报告日期的 `main` 仍有同一缺口：Anthropic stream parser 直接复制 `content_block.id/name`；Agent Loop 只按 `type === "toolCall"` 筛选；Anthropic replay builder 直接把 `msg.toolCallId` 写为 `tool_use_id`。三处均未验证非空字符串。
3. Pi 上游已有高度相关的 issue 和两个修复 PR。Issue [#4854](https://github.com/earendil-works/pi/issues/4854)描述空 ID、ghost tool call、`Tool not found` 和下一轮 400；PR [#4853](https://github.com/earendil-works/pi/pull/4853)建议在 Agent Loop 忽略空 `id/name`；PR [#4852](https://github.com/earendil-works/pi/pull/4852)建议在 OpenAI provider replay 层规范化 ID 并删除孤立结果。两个 PR 都因新贡献者门禁自动关闭，没有合并。
4. 上游记录主要覆盖 OpenAI-compatible 路径。未找到已经合并、专门覆盖 Anthropic-compatible 空 `tool_use.id/name` 或空 `tool_result.tool_use_id` 的修复。当前 Anthropic 源码检查也确认该路径仍未防御。
5. Anthropic 的协议合同要求 `tool_use` 携带用于结果关联的唯一 `id`、工具 `name` 和 `input`；下一轮 `tool_result.tool_use_id` 必须等于对应 `tool_use.id`。空 ID 无法满足关联合同，空 name 无法定位已声明工具。官方 stream 合同中，`content_block_start(tool_use)` 建立工具块，只有 `input` 以 `{}` 占位，实际参数通过后续 `input_json_delta` 累积；官方资料没有把空 `id/name` 定义为合法占位。
6. 现有 Zora transcript 没有保存原始 SSE，无法在模型生成层与火山协议适配层之间继续归因。能够确认的是：Pi Anthropic parser 不生成 ID，也不根据工具描述计算 name，只复制上游事件字段。因此 Zora Harness 的工具描述不会造成空 `id`；空字段到达 Pi 之前已经存在。GLM 模型生成了不完整工具决策，或火山 Agent Plan 将模型原生输出转换为 Anthropic SSE 时丢失字段，两种情况都需要原始 SSE 才能区分。
7. 修复位置应以 Pi SDK 层为主，Zora 产品层承担会话恢复与遥测。持续 Agent turn 中应丢弃非法调用，不执行、不生成空 ID 的 `tool_result`，继续执行同一响应中的合法调用。若该响应只包含非法调用，应结束当前 run 并返回可诊断的协议错误；不应为非法调用合成一个看似有效的工具 ID，也不应把错误结果回传给 Provider。

## 1. 最新稳定版本

2026-08-27 通过 npm 官方 registry 执行以下只读查询：

```bash
npm view @earendil-works/pi-ai version time --json
npm view @earendil-works/pi-agent-core version time --json
npm view @earendil-works/pi-coding-agent version time --json
```

结果：

| 包 | `latest` | 发布时间（UTC） | 官方来源 |
| --- | --- | --- | --- |
| `@earendil-works/pi-ai` | `0.84.3` | `2026-08-24T11:06:27.239Z` | [npm registry](https://registry.npmjs.org/%40earendil-works%2Fpi-ai/latest) |
| `@earendil-works/pi-agent-core` | `0.84.3` | `2026-08-24T11:02:21.238Z` | [npm registry](https://registry.npmjs.org/%40earendil-works%2Fpi-agent-core/latest) |
| `@earendil-works/pi-coding-agent` | `0.84.3` | `2026-08-24T11:09:37.600Z` | [npm registry](https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent/latest) |

Pi 将三个包作为同一仓库版本一起发布。[`v0.84.3`](https://github.com/earendil-works/pi/releases/tag/v0.84.3) 是当前 GitHub Latest Release。该发布的 Fixed 列表包含工具事件字段、compaction、Provider 适配等修复，但没有空工具调用修复。

## 2. 上游 issue、PR 与发布状态

### 2.1 Issue #4854：空 ID 与 ghost tool call

Pi issue [#4854](https://github.com/earendil-works/pi/issues/4854) 报告：

- OpenAI chat-completions 可能产生只有 arguments、没有 id/name 的流式 delta，Pi 可能把它当成独立 ghost tool call。
- Responses ID 可能保存为 `|fc_...`，导致 `call_id` 一侧为空。
- 非法调用进入历史并被回放后，Provider 返回空 `tool_call_id` / `call_id` 的 400；本地可先出现 `Tool not found`。
- 建议同时修改 Provider replay 层和 Agent Loop。

该 issue 的版本字段是 `0.75.4`，状态为 Closed，页面没有关联已合并 PR、assignee 或 milestone。它的关闭不代表修复已经进入主线；页面所列两个 PR 均被门禁自动关闭。

### 2.2 PR #4853：Agent Loop 防御

PR [#4853](https://github.com/earendil-works/pi/pull/4853) 的方案是：

- 只有 `id`、`name` 都为非空字符串的 tool call 才可执行。
- 判断是否存在工具轮次、顺序执行和并行执行使用同一过滤条件。
- 同一 assistant 响应中合法调用继续执行，空 ghost call 被忽略。
- 不为非法调用产生错误 `tool_result`，因为错误结果仍会保留空 `toolCallId` 并导致下一轮回放失败。

该 PR 只有一个 commit `d621413`，因新贡献者门禁自动关闭，没有 review，也没有合并。

### 2.3 PR #4852：Provider replay 防御

PR [#4852](https://github.com/earendil-works/pi/pull/4852) 只处理 OpenAI-compatible provider：

- 合并只有 arguments 的 chat delta，而不创建新 ghost call。
- 为 OpenAI replay 规范化或补全非空 ID。
- 删除没有对应 assistant tool call 的孤立 tool output。

该 PR 只有一个 commit `482c8b1`，同样因门禁自动关闭，没有合并。它没有修改 Anthropic-compatible replay。

### 2.4 其他相关 issue

Pi issue [#2119](https://github.com/earendil-works/pi/issues/2119) 报告了两个相邻问题：孤立 `tool_result` 会被 Anthropic 以 `unexpected tool_use_id` 拒绝；代理或网络故障可留下 `stopReason: "toolUse"` 但没有任何 tool call block。该 issue 没有关联 PR。它说明 Provider/代理异常可能产生不完整工具轮次，但没有覆盖本次“存在 block、`id/name` 为空”的精确结构。

未在 `v0.84.3` release notes、当前 `main` 源码或官方 issue/PR 记录中发现已经合并的精确修复。

## 3. `v0.84.3` 与当前 `main` 源码检查

### 3.1 Anthropic stream parser

[`packages/ai/src/api/anthropic-messages.ts`](https://github.com/earendil-works/pi/blob/v0.84.3/packages/ai/src/api/anthropic-messages.ts#L639-L653) 在收到 `content_block_start` 的 `tool_use` 后直接构造：

```ts
{
  type: "toolCall",
  id: event.content_block.id,
  name: event.content_block.name,
  arguments: event.content_block.input ?? {},
}
```

OAuth 工具名会经过名称转换，但转换前后都没有非空校验。当前 [`main` 的同一文件](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/anthropic-messages.ts#L639-L653) 行为一致。

因此，Anthropic 路径和 OpenAI ghost delta 的生成机制不同：Anthropic parser 不会因为 `input_json_delta` 缺少 id/name 而新建调用，它只在 `content_block_start(tool_use)` 新建一次。若最终 Pi message 中为 `id: "", name: ""`，对应 `content_block_start` 事件已经提供了空字段，或上游 SDK 在运行时解析出了空字段。

### 3.2 Agent Loop 执行筛选

[`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/v0.84.3/packages/agent/src/agent-loop.ts#L199-L207) 只按 content type 选择工具调用：

```ts
const toolCalls = message.content.filter((c) => c.type === "toolCall");
```

执行函数内再次使用相同筛选，[没有检查 `id.trim()` 或 `name.trim()`](https://github.com/earendil-works/pi/blob/v0.84.3/packages/agent/src/agent-loop.ts#L414-L427)。当前 [`main`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L199-L207) 仍相同。

结果是空 name 进入正常工具查找，生成 `Tool not found`；生成的 `ToolResultMessage` 继续携带空 `toolCallId`。

### 3.3 Anthropic replay builder

[`packages/ai/src/api/anthropic-messages.ts`](https://github.com/earendil-works/pi/blob/v0.84.3/packages/ai/src/api/anthropic-messages.ts#L1133-L1147) 的 `convertToolResult()` 直接写入：

```ts
{
  type: "tool_result",
  tool_use_id: msg.toolCallId,
  content: ...,
  is_error: msg.isError,
}
```

代码不检查非空值，也不验证历史中是否存在同 ID 的 `tool_use`。当前 [`main`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/anthropic-messages.ts#L1133-L1147) 仍相同。

### 3.4 版本判断

升级到 `0.84.3` 可以获得该版本的其他修复，但不能解决本次空工具调用链路。当前 `main` 在 release 之后仍未加入上述三处校验，因此仅等待下一个未确认版本也没有可验证依据。

## 4. Anthropic 官方协议合同

Anthropic 官方 [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) 规定 client tool response 包含：

- `id`：该次 tool use 的唯一标识，用于后续结果匹配。
- `name`：要调用的工具名称。
- `input`：符合工具 `input_schema` 的对象。

下一轮应用应发送 `tool_result`，其中 `tool_use_id` 取对应 `tool_use.id`。官方 [Create a Message API reference](https://platform.claude.com/docs/en/api/messages/create) 将 `ToolUseBlock` 的 `id`、`name`、`input` 都列为对象字段；工具定义的 `name` 约束为 1 到 128 个字符。

Anthropic 官方 [Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming) 和 [Fine-grained tool streaming](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/fine-grained-tool-streaming) 说明：

1. `content_block_start` 创建 `tool_use` block。
2. 初始 `input: {}` 是占位对象。
3. `input_json_delta.partial_json` 只更新 input，按 index 累积。
4. `content_block_stop` 后解析完整 input。

官方只允许 input 在 block start 时为空占位。没有规定 id/name 可在后续 delta 补齐。由此可知，`content_block_start(tool_use)` 中的空 id/name 不符合官方工具关联合同。

## 5. 火山 Agent Plan 公开资料

核查了火山方舟公开的 [Agent Plan / Coding Plan API 参考资源](https://www.volcengine.com/docs/82379/2123434?lang=zh)、[接入三方工具指南](https://docs.volcengine.com/docs/82379/2160841?lang=zh) 以及公开文档站内关于 `api/plan`、`content_block_start`、`tool_use`、Anthropic SSE 的检索结果。

公开资料能够确认 Agent Plan 为 Claude Code 等工具提供 Anthropic-compatible 接入地址，但没有找到定义以下内容的官方公开页面：

- Agent Plan 工具调用的逐事件 SSE schema。
- `content_block_start(tool_use)` 的 id/name 生成责任。
- GLM 模型原生工具调用到 Anthropic Messages 的转换规则。
- 空或缺失 id/name 的服务端处理约定。

火山方舟公开的普通 Responses API [工具调用文档](https://www.volcengine.com/docs/82379/1958524?lang=zh) 使用 `function_call.call_id` 关联 `function_call_output.call_id`，也要求调用与结果使用一致的关联 ID；该页面不描述 Agent Plan 的 Anthropic-compatible SSE，不能用于证明 Agent Plan 的具体 wire shape。

因此，公开资料不足以继续区分“GLM 原生模型生成异常”与“Agent Plan Anthropic 适配器转换异常”。需要保存原始 SSE 或向火山提交 Request ID 进行服务端追踪。

## 6. 责任边界

| 层级 | 已确认事实 | 责任判断 |
| --- | --- | --- |
| Zora Harness 工具定义 | Harness 发送工具 name、description、input schema；不生成 Provider response 中的 tool-use ID。 | 工具描述可能影响模型选择哪个工具及参数质量，无法导致响应关联 ID 为空。 |
| GLM 模型 | 当前没有模型原生输出或服务端 trace。 | 是否生成了空工具名，原因未查明。 |
| 火山 Agent Plan 适配层 | 对外提供 Anthropic-compatible response；原始 SSE 未保存。 | 空字段可能在模型到 Anthropic SSE 的转换中产生，原因未查明。 |
| Pi Anthropic parser | 直接复制上游 `id/name`，没有验证。 | 未制造字段值，但接受了违反协议不变量的数据。 |
| Pi Agent Loop | 执行空调用并产生空 ID 的 error result。 | 将一次非法 Provider fragment 扩大为可持久化、可回放的坏历史。 |
| Pi Anthropic replay | 原样发送空 `tool_use_id`。 | 直接触发下一轮 Provider 400。 |
| Zora 产品层 | 映射并持久化 Pi 事件，当前没有原始 SSE。 | 需要提供防护、可观测性和已有会话恢复；核心解析与执行不变量应归 Pi SDK 层。 |

## 7. 修复建议

### 7.1 Pi SDK 主修复

建议在 Pi 的公共语义层加入一个统一不变量：可执行 `ToolCall` 必须满足：

```ts
typeof call.id === "string" && call.id.trim().length > 0
&& typeof call.name === "string" && call.name.trim().length > 0
```

具体位置：

1. **Anthropic parser 边界**：`content_block_start(tool_use)` 收到空 id/name 时，不把它作为正常 `toolCall` 对外完成。记录 provider protocol error，保留原始事件诊断信息。
2. **Agent Loop 执行边界**：再次过滤，作为跨 Provider 的 defense-in-depth。合法调用与非法调用混合时只执行合法调用。
3. **Anthropic replay 边界**：不发送空 `tool_use.id`、空 `tool_result.tool_use_id` 或孤立结果。历史清理必须成对处理 assistant tool call 和 user tool result。

第一项负责尽早识别协议异常；第二项防止其他 parser 或已持久化历史绕过；第三项保证 Provider 请求始终合法。只改其中一处覆盖不完整。

### 7.2 连续 Agent turn 的处理

| 场景 | 建议行为 |
| --- | --- |
| 同一响应含合法调用和空调用 | 丢弃空调用；执行全部合法调用；只为合法调用生成 `tool_result`；随后由 Agent Loop 正常继续。 |
| 响应只含空调用，另有可用正文 | 保留正文供 UI 和诊断；结束当前 run，返回 `provider_protocol_error`；不自动回放。 |
| 响应只含空调用，无正文 | 结束当前 run并显示可重试的 Provider 协议错误；可以由 SDK 在无副作用前提下执行一次内部重试，但必须有次数上限并保留原始 Request ID。 |
| 历史中已有空调用及关联空结果 | 构建 active context 时成对删除，不修改原始 append-only JSONL；生成一个新的有效 checkpoint/派生上下文。 |
| 历史中存在孤立合法 ID 的 `tool_result` | 从 active Provider context 中删除孤立结果，并记录恢复事件；不合成不存在的 assistant tool call。 |

不建议返回 `Tool not found` 给模型。该错误适用于 name 非空、但产品没有注册该工具的情况。name 为空属于 Provider 协议错误，构造 `tool_result` 需要一个合法关联 ID，当前不存在该 ID。

不建议合成随机 ID 后把空 name 的错误结果发回 Provider。合成 ID 会伪造一条 Provider 没有产生的调用关系，也无法确定模型原本想调用哪个工具。

### 7.3 Zora 产品层

Pi 上游未合并修复前，Zora 可在 Pi integration boundary 加窄范围补丁，但补丁语义应与 SDK 目标一致：

- 在事件进入执行和产品持久化之前拒绝空 id/name。
- 不把非法调用展示为普通工具调用，不生成普通 `Tool not found`。
- 增加结构化诊断：Provider、model、Pi version、response/request ID、content block index、stop reason；敏感内容按现有日志策略处理。
- 为 Anthropic-compatible Provider 增加可选原始 SSE trace，仅在诊断开关开启时保存，并设置脱敏与生命周期。
- 恢复旧会话时只改变 active Pi context 或生成新派生 checkpoint，保留原始 transcript 供追溯。

这里的“恢复 checkpoint”指 Zora 创建 Pi Session 时，Pi 的 `SessionManager` 从 append-only JSONL 构建 active message path。Pi SDK 自带会话恢复和 active context 重建能力，但它当前没有“自动清洗空工具调用”的能力。具体建议是在 Zora 的 Pi session 装配或 Pi 上游 SessionManager 的 context transform 中，对构建出的 active messages 执行成对校验；原始 JSONL 不原地编辑。若项目选择删除 Pi 派生 checkpoint，则从 Zora 的产品会话历史重新创建一份 Pi session，属于 Zora 的恢复策略，不是 Pi SDK 已有的一键修复 API。

## 8. 验证建议

### L1 / Pi adapter

1. `content_block_start(tool_use)` 为 `id="", name=""`，断言不产生可执行 tool call。
2. 同一 assistant response 包含一个合法调用和一个空调用，断言合法调用执行一次，空调用没有 `tool_execution_start` 和 `tool_result`。
3. 空白字符 `"   "` 与空字符串等价。
4. replay builder 不输出空 `tool_use.id`、空 `tool_result.tool_use_id` 或孤立结果。
5. 旧 transcript 的清理保持合法调用与结果的顺序，不删除同轮正文和其他合法调用。

### L2 / Runtime

1. Provider fake 返回混合调用，完整 run 在同一 `session.prompt()` 内继续并得到最终正文。
2. Provider fake 只返回空调用，run 以明确的 `provider_protocol_error` 结束，不产生下一次包含空 ID 的请求。
3. 加载含空调用的历史 checkpoint，下一次合法用户消息可以继续；发给 Provider 的 active context 不含非法 block。

### L3 / Provider

在真实火山 Agent Plan 上使用能够稳定触发工具调用的任务，保存脱敏后的原始 SSE：

- 确认 `content_block_start(tool_use)` 的原始 id/name。
- 对照同一 Request ID 的 Pi parsed message。
- 若原始 SSE 已为空，向火山提交 Request ID；若原始 SSE 非空而 Pi 解析后为空，再定位 Anthropic SDK/Pi parser。

当前两份现场只有 Pi 解析后的 transcript。任何关于 GLM 模型或火山适配器的进一步归因都需要上述原始事件证据。
