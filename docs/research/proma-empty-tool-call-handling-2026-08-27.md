# Proma 对空工具调用的处理设计检查

日期：2026-08-27  
检查对象：`/Users/bytedance/Desktop/03-code/github_ref/Proma`  
检查版本：`447169c791c4421c3e9618a45e1f2f3879b08282`（author date 2026-08-06，committer date 2026-08-13）  
资料范围：Proma 本地源码、测试、设计文档、锁文件、已安装的 Pi 包源码。未使用二手资料。

## 结论

Proma 当前没有针对 `toolCall.id` 或 `toolCall.name` 为空的专门处理。它没有产品级空工具调用守卫，也没有为此修改 Pi SDK，没有受污染 Pi artifact 的空调用检测，没有针对这类协议异常的自动重试策略。

按当前静态调用链和本地最小复现，Proma 的 Pi Agent 路径会发生与 Zora 相同的链路：

1. Anthropic-compatible Provider 返回空 `tool_use.id/name`。
2. Pi Anthropic parser 原样构造 canonical `toolCall`。
3. Pi Agent Loop 仅按 `type === "toolCall"` 选择调用。
4. 空工具名进入执行阶段，产生 `Tool  not found`。
5. Pi 生成空 `toolCallId` 的错误结果。
6. Anthropic replay 原样发送空 `tool_use` 和空 `tool_use_id`。
7. Provider 的下一次请求校验可能返回 `400 InvalidParameter`。

Proma 有三套可以借鉴的相邻设计：

- 通过 Pi 公共 seam 在产品边界处理数据，例如 `afterToolCall`、`transformContext`、`streamFunction`。
- 对确定失效的 Pi artifact，创建新的 Pi session，并从 Proma 产品历史恢复上下文，不原地修改 Pi JSONL。
- 对必须进入 Pi 内部的行为，使用精确版本锁定和小型 Bun patch，不维护完整 fork。

这些设计目前用于图片内容校验、resume 恢复和 native retry，没有覆盖空工具调用。

## 版本与 Pi 依赖策略

Proma Electron 应用版本为 `0.17.26`：

- `Proma/apps/electron/package.json:1-4`

Pi 相关包全部精确锁定为 `0.82.1`：

- `Proma/package.json:36-40`
- `Proma/apps/electron/package.json:43-47`
- `Proma/bun.lock:213-216,321-327`

根 `package.json` 通过 `overrides` 保证 Pi 包版本一致，通过 Bun `patchedDependencies` 应用两个本地补丁：

- `Proma/package.json:36-45`

补丁内容与空工具调用无关：

- `Proma/patches/@earendil-works%2Fpi-ai@0.82.1.patch:1-22` 只扩充瞬时传输错误的 retry pattern。
- `Proma/patches/@earendil-works%2Fpi-coding-agent@0.82.1.patch:75-249,252-301` 只扩充 native retry 的总预算、jitter 和生命周期事件。

因此，Proma 的既有依赖策略可以概括为：官方包、精确版本、小型补丁。`pi-agent-core` 没有 patched dependency，空工具调用的 Agent Loop 行为保持上游默认实现。

## Pi Agent 路径

### Provider 解析

Proma 使用已安装的 `@earendil-works/pi-ai@0.82.1` 处理 Pi Agent Provider 响应。Anthropic parser 在 `content_block_start` 收到 `tool_use` 时直接复制字段：

- `Proma/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:396-440`
- 其中 `id/name/arguments` 的赋值在 `:430-434`。

该实现没有执行以下校验：

```ts
block.id.trim().length > 0
block.name.trim().length > 0
```

OpenAI-compatible Pi parser 也可能保留空调用：

- `Proma/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:248-295`

它在首次发现 tool-call delta 时使用 `id || ""`、`name ?? ""` 建立 block。后续 delta 没有补齐时，最终 canonical `ToolCall` 仍可能为空。

### Agent Loop

Pi Agent Loop 只检查内容块类型：

- `Proma/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:105-129`
- `toolCalls` 的过滤条件位于 `:114`。

执行阶段再次只按类型获取调用：

- `Proma/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:285-305`

找不到工具时，Pi 生成错误结果：

- `Proma/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:393-400`

空工具名会得到 `Tool  not found`，原始空调用 ID 继续成为工具结果的关联 ID。

### Provider replay

Anthropic replay 直接使用 `ToolResultMessage.toolCallId`：

- `Proma/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:803-829`
- `tool_use_id` 的赋值位于 `:818-822`。

assistant tool call 也直接回放 `id/name`：

- `Proma/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:925-931`

因此，仅在产品 UI 映射层隐藏空工具调用不能阻止下一次 Provider 请求失败。

### 产品消息转换

Proma 的 Pi 消息兼容层也直接保留空字段：

- assistant `toolCall` 转 `tool_use`：`Proma/apps/electron/src/main/lib/adapters/pi-message-adapter.ts:235-285`，核心映射位于 `:261-271`。
- `toolResult` 转 `tool_result`：`Proma/apps/electron/src/main/lib/adapters/pi-message-adapter.ts:288-304`。

空调用会进入 Proma 展示 JSONL。该层没有调用合法性校验。

### `beforeToolCall` 与参数校验不能覆盖

Proma 已安装的 `beforeToolCall` 只约束 `CompactContext` 必须单独执行：

- `Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:729-746`

Proma 的 `validateToolInput` 只校验已知工具的必需参数：

- `Proma/apps/electron/src/main/lib/agent-tool-input-validator.ts:8-52`

未知工具会返回 `null`。Pi Agent Loop 在找不到工具时会直接生成错误结果，不会把空工具名转化为协议异常。因此这两个机制都不能处理空 `id/name`。

## 最小复现

使用 Proma 当前安装的 Pi `0.82.1`，给 Agent Loop 注入一个只包含空工具调用的 assistant response，再提供一个正常文本 response 结束循环。

检查命令的核心断言是：结果中不得出现空 `toolCallId/toolName` 的 `toolResult`。当前输出为：

```json
{"requests":2,"blankToolResult":true,"toolCallId":"","toolName":"","isError":true}
```

命令退出码为 `1`，证明当前实现会生成空工具结果。该复现不访问网络，不依赖真实 Provider，执行时间约 0.3 秒。

对 Proma 产品消息适配器进行同样检查，输出为：

```json
{"preservedBlank":true,"block":{"type":"tool_use","id":"","name":"","input":{}}}
```

命令退出码为 `1`，证明产品层会保留空工具调用。

## Proma 已有的产品边界守卫模式

Proma 没有空工具调用守卫，但无效图片处理已经形成可复用模式。

### 新产生的数据在写入上下文前处理

Proma 在 `afterToolCall` 中清理新鲜工具结果中的无效图片：

- `Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1212-1239`

纯函数会删除空、格式错误、不支持或 MIME 不匹配的图片，并追加文本诊断：

- `Proma/apps/electron/src/main/lib/image-content-validation.ts:50-80`

这样能够防止新产生的非法内容污染 Pi transcript。

### 恢复的历史在请求边界处理

Proma 通过 `transformContext` 清理旧 Pi artifact 中的无效图片：

- `Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1426-1432`
- `Proma/apps/electron/src/main/lib/image-content-validation.ts:82-95`

源码注释明确把 `transformContext` 定义为恢复旧 transcript 时的最后请求边界。处理过程不修改原始 Pi artifact，只保证当前 outgoing context 有效。

### `streamFunction` 已作为产品 seam 使用

Proma 已经包装 `session.agent.streamFunction`，目前用于：

- Codex Fast Mode 的 provider-specific stream：`Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1446-1470`。
- 把代理作用域限制在 Provider stream：`Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1472-1478`。

当前没有对 `AssistantMessageEventStream` 中的 tool-call block 做校验或规范化。

这表明 Proma 已接受“通过 Pi 公共 seam 实现产品语义”的架构。Zora 可以沿用同一方式，把新 Provider 响应清理放在 `streamFunction` 包装器，把历史关系清理放在 `transformContext`。

## Retry 设计

Proma 使用 Pi 原生同-transcript retry：

- 配置位于 `Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1338-1355`。
- 单段最多 8 次，顶层 run 总计最多 8 次，累计 backoff 最多 5 分钟，jitter 为 ±20%。
- provider-level retry 保持默认 0，避免嵌套重试。

设计说明明确禁止外层重放原始 prompt，原因是这会重复执行已经完成的副作用工具：

- `Proma/docs/plans/2026-07-28-pi-retry-policy-design.md:3-11`
- 验收要求位于 `:17-24`。

该 retry 只覆盖 Pi 判定为可重试的瞬时错误。用 Proma 当前 `pi-ai@0.82.1` 检查与 Zora 相同结构的错误：

```json
{"retryable":false}
```

即 `400 InvalidParameter` 不会触发 Pi native retry。

Proma 的补丁主要增加以下瞬时错误：

- terminal event 缺失。
- JSON 响应截断或拼接损坏。
- HTTP chunked/SSE 中断。
- `Failed to fetch`。

证据：

- `Proma/patches/@earendil-works%2Fpi-ai@0.82.1.patch:5-22`
- `Proma/apps/electron/src/main/lib/adapters/pi-native-retry.test.ts:13-65`

这些错误与结构化工具调用关系损坏属于不同类别。把普通 400 全部标记为可重试会重复发送同一受污染上下文，无法恢复。

## Session 与 checkpoint 恢复

### 双事实源

Proma 使用两个会话记录：

- Pi `SessionManager` 管理的原生 append-only artifact，用于 resume、fork、rewind 和真实 Agent context。
- Proma 自己的 SDKMessage JSONL，用于产品展示、搜索和恢复输入。

Pi artifact 的打开和创建：

- `Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1305-1314`

Proma SDKMessage JSONL 的追加：

- `Proma/apps/electron/src/main/lib/agent-session-manager.ts:430-449`

源码明确指出，Pi 分叉必须通过 `SessionManager` 导出目标 branch，不能只复制展示 JSONL：

- `Proma/apps/electron/src/main/lib/agent-session-manager.ts:780-823`

### 已有恢复条件

外层编排最多允许一次 resume artifact 回退：

- `Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1522-1531`

当前只处理三类已知失效：

- session-not-found：`:1634-1641`
- thinking signature 不兼容：`:1643-1663`
- prompt too long：`:1666-1686`

恢复函数会取消本轮 resume，必要时清除持久化 session 指针，再创建新的 Pi artifact：

- `Proma/apps/electron/src/main/lib/agent-orchestrator.ts:446-481`

新 session 通过恢复 prompt 读取 Proma 产品历史：

- `Proma/apps/electron/src/main/lib/agent-session-context-prompt.ts:145-173`
- `Proma/apps/electron/default-skills/session-cleaner/SKILL.md:8-25,78-102`
- `Proma/packages/session-core/src/transcript.ts:75-94`

Session Cleaner 会丢弃原始 `tool_result`，把工具调用转为文本摘要。它适合把产品历史作为新 session 的上下文来源，不会把空 `tool_use_id` 以结构化协议块回放给 Provider。

### 空工具调用当前不会触发恢复

普通 `InvalidParameter` 不匹配 session-not-found、thinking signature 或 prompt-too-long。不可重试错误的末尾逻辑会保留 Pi session ID：

- `Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1989-2016`
- 保留 session ID 的代码位于 `:2011-2014`。

因此，受污染 Pi artifact 可能在下一轮继续 resume，并再次回放空调用关系。

Proma 没有在 `SessionManager.open()` 后扫描以下异常：

- 空 `toolCall.id/name`。
- 空 `toolResult.toolCallId`。
- 没有对应调用的孤立结果。
- 重复工具调用 ID。

## Proma 自研 Chat 路径

Proma 另有一套不经过 Pi Agent 的 Chat Provider 适配器。该路径有部分协议 fallback，但没有形成统一合法性守卫。

### OpenAI Chat Completions

OpenAI adapter 在缺少调用 ID 时合成 `tc_<index>`，后续 arguments-only delta 使用当前调用关联：

- `Proma/packages/core/src/providers/openai-adapter.ts:240-258`
- `Proma/packages/core/src/providers/sse-reader.ts:298-319`

该逻辑可以处理“首个 delta 有 name、没有 id”的部分兼容 Provider 行为。它不能证明工具名有效，也没有统一的调用结果配对校验。

### OpenAI Responses

Responses adapter 使用 `call_id`、item `id` 或 `call_<outputIndex>` 构建关联 ID，并通过 `output_index` 关联交错参数 delta：

- `Proma/packages/core/src/providers/openai-responses-adapter.ts:119-133,289-347`
- 对应测试：`Proma/packages/core/src/providers/openai-responses-adapter.test.ts:57-138`

### Anthropic Chat

Anthropic adapter 对缺失字段使用空字符串：

- `Proma/packages/core/src/providers/anthropic-adapter.ts:391-409`

SSE reader 会用空 ID 作为 Map key，并最终输出 `ToolCall`：

- `Proma/packages/core/src/providers/sse-reader.ts:298-319,333-350`

Chat Service 直接执行这些调用并构建下一次 continuation：

- `Proma/apps/electron/src/main/lib/chat-service.ts:321-390`
- 未知空工具名会生成保留原始 ID 的错误结果：`Proma/apps/electron/src/main/lib/chat-tool-executor.ts:42-79`

所以，自研 Chat 的 Anthropic 路径也可能产生与 Pi Agent 相同的空调用、空结果和下一次请求失败链路。OpenAI fallback 是特定 adapter 的补全策略，不能作为 Pi Agent 已解决空工具调用的证据。

## 火山 GLM-5.2 路径

Proma 的 `ark-coding-plan` 默认映射到 Pi `anthropic-messages`：

- `Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:301-317`

火山 GLM-5.2 有输出上限特例：

- `Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:530-552`

GLM-5.2 的 Anthropic reasoning profile 使用 adaptive effort：

- `Proma/packages/shared/src/types/reasoning-profile.ts:237-246`
- Pi compat 编译：`Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:83-120`

Proma 源码没有为该路径设置 `allowEmptySignature`。这会改变 thinking block 的请求形态，可能影响空调用的触发概率，但没有形成空工具调用防御。仅凭静态源码不能确认 Proma 是否在真实火山请求中复现过同一问题。

## 与 Zora 的比较

| 能力 | Proma 当前实现 | 对 Zora 的启示 |
| --- | --- | --- |
| 新 Provider 响应的空 tool-call 校验 | 没有 | 在 Pi Agent Loop 前校验 canonical `ToolCall` |
| 历史 replay 清理 | 只处理无效图片 | 扩展为工具调用与结果关系清理 |
| 产品消息映射校验 | 没有，空字段原样保留 | mapper 作为最后显示防线，但不能承担核心修复 |
| checkpoint 空调用检测 | 没有 | 打开 Pi artifact 后校验 active path |
| artifact 恢复 | 对 session-not-found、signature、overflow 新建 Pi session | 沿用“新 artifact + 产品历史恢复”，不原地修改 Pi JSONL |
| Provider 400 retry | `InvalidParameter` 不重试 | 协议异常需要先清理上下文，再执行有界重试 |
| Pi 依赖修改 | 精确版本 + Bun patch | 公共 seam 不足时使用小型补丁，避免长期 fork |
| Pi 版本升级 | 根 overrides 保证多包同版本 | 保持 Pi 包版本一致，并用合同测试验证 guard |

## 建议

### 产品修复

优先新增集中式 `PiProtocolGuard`：

1. `streamFunction` 包装器校验新 assistant response。
2. 对合法调用和非法调用混合的响应，只删除非法调用，保留并执行合法调用。
3. 全部调用均非法时，不执行、不生成空结果，从 Provider 请求前的上下文重试一次。
4. `transformContext` 删除旧 artifact 中的空调用、空结果和孤立结果。
5. 产品消息 mapper 拒绝空 `id/name`，避免 UI 与产品 JSONL继续保存非法结构。

### Artifact 恢复

沿用 Proma 已验证的恢复结构：

1. `SessionManager.open()` 后检查 active context。
2. 发现非法工具关系时，将该 Pi artifact 标记为不可继续。
3. 保留原 artifact 供诊断。
4. 创建新的 Pi session。
5. 从 Zora 产品历史构造干净的恢复上下文。

不要逐行编辑 Pi JSONL。Pi artifact 是 append-only tree，消息 parent/branch 关系由 Pi 管理。

### Pi 依赖策略

优先使用公开 seam。如果 `streamFunction` 无法在保持 partial/final event 一致性的前提下安全删除非法 block，可以使用 Proma 当前采用的策略：

- 精确锁定所有 Pi 包到同一版本。
- 通过 Bun `patchedDependencies` 修改最小内部位置。
- patch 只覆盖 parser/Agent Loop/replay 的协议校验。
- 每次升级用合同测试验证 patch 是否仍需要、能否删除。
- 同步向 Pi 上游提交修复。

不建议维护完整 Pi fork。Proma 现有源码也没有采用长期 fork。

## 建议回归测试

1. Anthropic stream 返回一个合法调用和一个空调用，只有合法调用执行。
2. OpenAI Chat delta 缺少首段 ID 或 name，不产生空 canonical `ToolCall`。
3. OpenAI Responses 多调用交错，不产生重复或孤立调用。
4. assistant 只返回空调用时，有界重试一次，不生成 `toolResult`。
5. `transformContext` 清理空调用、空结果、重复 ID 和孤立结果。
6. 恢复受污染 artifact 后，outgoing Provider payload 不包含空 ID/name。
7. 合法但未注册的工具仍生成带有效 ID 的错误结果，保留模型自我修正能力。
8. 合法与非法混合时，不重放已经执行的合法副作用工具。

## 总结

Proma 没有现成的空工具调用修复。它当前同样依赖 Pi 对 canonical tool call 的正确性，`pi-ai@0.82.1`、`pi-agent-core@0.82.1` 和 Proma 产品映射都没有非空校验。

Proma 最有价值的参考是处理类似持久化污染问题时采用的边界设计：新数据尽早清理，旧 artifact 在 `transformContext` 请求边界清理，确定失效时创建新 Pi session 并从产品历史恢复。依赖层面的深层改动使用精确版本和小型 Bun patch。Zora 可以直接沿用这套分层，同时补上 Proma 尚未覆盖的 tool-call 合法性与关联完整性。
