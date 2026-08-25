# Pi 输出预算与上下文压缩评估

日期：2026-08-25
范围：Zora 当前锁定的 `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent` 0.84.2，以及本地 Proma 当前源码。结论均基于已安装的 Pi 源码、Pi 随包文档和参考项目源码。

## 结论

将 Zora 的 Pi `maxOutputTokens` 提升到 64K 或更高时，**不应**因为这个数值改变自动 compaction 的阈值。当前 Zora 的实现将 `reserveTokens` 设为“上下文窗口的 20%”与“最大输出预算”中的较大值。该实现会使输出预算从 16K 提升到 64K 后，200K context window 的自动压缩点由 160K 提前到 136K；提升到 128K 后会提前到 72K。

Pi SDK 原生 API 没有这样的绑定。它把 `reserveTokens` 作为独立的上下文余量，默认值为 16,384。Proma 也独立配置为 context window 的 20%，不读取模型 `maxTokens`。Pi 在真正发请求前会根据当前输入上下文单独收紧该请求的 `maxTokens`，并在“实际输出低于模型原始输出目标但以 `length` 结束”时执行一次原生的压缩与 `agent.continue()` 恢复。

因此，建议保留 Zora 已选定的 80% context 阈值，但删除 `maxOutputTokens` 对 reserve 的影响：

```ts
reserveTokens = Math.ceil(contextWindow * 0.2)
threshold = contextWindow - reserveTokens
```

这项调整与提高输出上限可以同时进行。它们解决的资源维度不同：

| 机制 | 目标 | 建议 |
| --- | --- | --- |
| 模型 `maxTokens` | 一次响应可用于 reasoning、工具决策和正文的总输出额度 | 按模型能力设置；Zora Productivity 的 64K 是当前候选值。 |
| Pi `reserveTokens` | 历史上下文达到何处开始总结 | 固定为模型 context window 的 20%，不随 `maxTokens` 改变。 |
| Pi 请求级输出收紧 | 当前请求已有多少输入空间时，最多还能请求多少输出 | 交给 Pi 原生 `clampMaxTokensToContext()`。 |
| `length` 恢复 | 由于上下文压力或 Provider 截断而提前结束的响应 | 使用 Pi 0.84.2 已有的原生 compact-and-continue。 |

## 1. 当前 Zora 行为

Zora 当前在创建 Pi Session 时注册模型：

```ts
maxTokens: providerConfig.maxTokens
  ? Math.min(providerConfig.maxTokens, modelTuning.maxOutputTokens)
  : modelTuning.maxOutputTokens
```

随后又为 Pi 设置：

```ts
reserveTokens: Math.max(
  Math.ceil(contextWindow * 0.2),
  Math.ceil(maxOutputTokens),
)
```

来源：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-session-bridge.ts:137-144`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-session-bridge.ts:217-223`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-compaction.ts:1-29`

对 200K context window，这一公式的结果如下：

| `maxOutputTokens` | reserve | 自动 compaction 阈值 | 相对 80% 阈值的变化 |
| ---: | ---: | ---: | --- |
| 16,384 | 40,000 | 160,000 | 无变化 |
| 64,000 | 64,000 | 136,000 | 提前 24,000 tokens |
| 128,000 | 128,000 | 72,000 | 提前 88,000 tokens |

当前 16K 小于 200K 的 20%，因此此前没有暴露这个耦合。将输出预算提升到 64K 或 128K 后，阈值会发生显著变化。代码的现有单元测试也把这一行为作为预期：`maxOutputTokens` 大于 20% context 时，reserve 等于输出预算。

来源：`/Users/bytedance/Desktop/03-code/ZoraAgent/tests/unit/main/pi-compaction.test.ts:6-39`。

## 2. Pi 0.84.2 的原生 compaction 机制

### 2.1 阈值只由 `reserveTokens` 决定

Pi 默认设置为：

```ts
const DEFAULT_COMPACTION_SETTINGS = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
}
```

触发条件为：

```text
contextTokens > contextWindow - reserveTokens
```

`shouldCompact()` 不读取模型 `maxTokens`。Pi 随包的 Compaction 文档也将 `reserveTokens` 描述为独立可配置的“为 LLM response 留出的空间”。

来源：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js:56-62`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js:141-147`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/docs/compaction.md:18-35`

Pi 的 16,384 默认 reserve 并不要求应用使用 16K 输出上限。它只是 SDK 的默认上下文余量。应用可覆盖该值，例如 Proma 的 20% 策略。

### 2.2 Pi 已在请求发送前收紧本轮输出

Pi AI 的 `clampMaxTokensToContext()` 在每次请求前计算：

```text
available = model.contextWindow - estimatedContextTokens - 4,096
request.maxTokens = min(model.maxTokens, max(1, available))
```

因此，即使模型原始 `maxTokens` 为 64K，当实际输入上下文已接近窗口时，Pi 仍会降低该次 Provider 请求的最大输出，保留 4,096 tokens 的安全余量。这个请求级处理直接处理“当前请求还能容纳多少输出”，不需要让全局 compaction 阈值随模型输出能力移动。

来源：`/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-ai/dist/api/simple-options.js:1-19`。

当前 Zora 的 Provider 路径使用 `openai-completions` 时，同样会经由 `buildBaseOptions()` 调用这段 clamp 逻辑。

来源：`/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:466-481`。

### 2.3 `length` 的可恢复语义

Pi 0.84.2 已包含 `isRecoverableLength()`：

```ts
message.stopReason === "length"
  && desiredMaxOutput > 0
  && message.usage.output < desiredMaxOutput
```

`desiredMaxOutput` 使用注册模型的原始 `model.maxTokens`，不会使用因上下文压力而临时收紧的请求值。满足条件后，Pi 会：

1. 从 active agent state 移除本次截断 assistant message。
2. 以 `reason: "overflow"` 执行 compaction。
3. 将 `willRetry` 标记为 `true`。
4. 在同一 `session.prompt()` 内调用 `agent.continue()` 恢复被中断的任务。
5. 对同一次 prompt 最多执行一次这种恢复，第二次失败结束并返回明确错误，避免无限循环。

来源：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js:156-165`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1510-1583`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1680-1710`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:753-762`

这项语义需要区分两种情况：

| `length` 现场 | Pi 0.84.2 行为 |
| --- | --- |
| 实际输出 `< model.maxTokens` | 判定为可恢复 length，压缩后在同一任务内继续一次。该条件覆盖上下文压力和部分 Provider 提前截断。 |
| 实际输出 `= model.maxTokens` | 视为已触及调用者设置的单次输出硬上限，不自动续跑。 |

用户截图对应的原始会话中，`usage.output = 16,384`，与 Zora 注册模型的 `maxTokens = 16,384` 一致。因此它属于第二种情况：Pi 把它看作调用方设定的真实输出上限，产品显示“发送继续”是符合 Pi 语义的终态。提高 `maxOutputTokens` 是这个个案的直接修复手段；调整 compaction 阈值无法把“恰好耗尽 16K 输出预算”转为可恢复 length。

## 3. Proma 当前实现

Proma 在 Pi Session 创建时独立计算 reserve：

```ts
reserveTokens = Math.ceil(contextWindow * 0.2)
```

它不会将 `model.maxTokens` 传入这一计算。Proma 注释明确将该设置解释为“上下文达到模型窗口约 80% 时触发自动压缩”。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/utils/pi-compaction.ts:1-21`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1315-1344`

Proma 的模型注册把 `contextWindow` 与 `maxTokens` 分开处理。默认模型能力回退为 200K context window 和 64K maxTokens，特定已验证模型可使用 128K maxTokens。

来源：`/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:45-57`、`:537-552`、`:751-772`。

Proma 当前锁定 Pi 0.82.1，长度恢复条件较窄，仅把 `length + output=0 + input 接近整个 context window` 归类为 overflow。它的产品层 terminal gate 不能替代 Pi 0.84.2 的 `isRecoverableLength()`，但其“80% 阈值独立于 maxTokens”的配置方式可直接作为 Zora 的参考。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:697-727`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/package.json:3`

## 4. 当前 Zora 适配层与 Pi 原生恢复的关系

Zora 的 `PiEventMapper` 已适配 Pi 的恢复事件顺序：收到 `stopReason: "length"` 时先不将其作为产品终态；Pi 完成压缩并继续时保留本轮；只有 `agent_settled` 后仍存在未恢复的 length 才显示终态错误。这与 Pi 在 `message_end` 后、`agent_settled` 前决定 compaction/retry 的时序一致。

来源：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-event-mapper.ts:399-477`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/tests/unit/main/pi-event-mapper.test.ts:362-438`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md:841-842`、`:882-888`、`:1040-1078`

因此，当前项目不需要再在 bridge 外层添加“收到 length 后构造一条继续 prompt”的兼容层。Pi 0.84.2 已在同一 transcript 内使用 `agent.continue()`，能够保留已完成的工具结果，并避免重放有副作用的工具调用。

## 5. 可执行调整

### 必须调整

1. 修改 `calculatePiCompactionReserveTokens()`，删除 `maxOutputTokens` 参数和 `Math.max(..., maxOutputTokens)`。

   ```ts
   export function calculatePiCompactionReserveTokens(contextWindow: number): number {
     // 保留现有入参校验
     return Math.ceil(contextWindow * 0.2)
   }
   ```

2. 修改 `calculatePiCompactionThresholdTokens()`、`PiContextTracker`、`PiSessionBridge` 的调用签名，避免继续把任务级输出预算传播到 compaction 策略。

3. 更新单元测试。对于 200K context window，16K、64K、128K 三种输出预算都应得到：

   ```text
   reserveTokens = 40,000
   thresholdTokens = 160,000
   ```

4. 将 Productivity 的输出预算提升与该重构分开验证。建议先确认当前 GLM-5.3 接入点接受 64K，随后再评估可否设置模型级 128K。模型能力上限仍应由 `min(providerConfig.maxTokens, profile maxOutputTokens)` 处理。

### 必须回归

| 层级 | 用例 | 验收 |
| --- | --- | --- |
| L1 | reserve 与 maxOutputTokens 解耦 | 200K context window 下，输出预算变化不改变 40K reserve 与 160K threshold。 |
| L2 | 可恢复 length | 模拟 `length` 且 `usage.output < model.maxTokens`，断言 `compaction_start(reason=overflow)`、`compaction_end(willRetry=true)` 和后续最终回答处于同一个 `session.prompt()`。 |
| L2 | 真实上限 length | 模拟 `usage.output === model.maxTokens`，断言不产生内部续跑，最终显示输出长度上限。 |
| L2 | 阈值压缩 | `contextTokens > 160K` 时执行 `reason=threshold` compaction，未排队消息时不自动继续当前 Agent run。 |
| L3 Provider | GLM-5.3 长文档任务 | 配置 64K 后，多文档读取与高推理任务输出最终正文；若 Provider 提前 length，验证 Pi 自动压缩并继续，而非要求用户重新发送。 |

## 6. 不建议的调整

- 不将 reserve 设置为 64K 或 128K 以匹配模型输出上限。Pi 的请求级 clamp 已处理临近 context 时可请求的输出量；过大的 reserve 会过早压缩历史，降低单次任务可直接利用的原始工具结果和对话细节。
- 不把 compaction 当成 16K 输出上限的补救措施。上下文压缩不会扩大 Provider 已收到的 `maxTokens`。
- 不复制 Proma 0.82.1 的长度分类器。Zora 已使用 Pi 0.84.2，其原生 `isRecoverableLength()` 判定范围更完整，并且恢复在同一 transcript 内进行。
- 不通过产品层重放原始用户 prompt 处理 recoverable length。Pi 原生 `agent.continue()` 会延续现有 Agent state，减少重复工具调用和副作用风险。

## 7. 结论对应用户疑问

“压缩应该不会因为 max output 而提前”的判断与 Pi 原生机制一致。当前 Zora 的提前压缩来自项目自定义公式，不来自 Pi SDK，也不来自 Proma。将输出预算提高到尽可能大时，应优先核对该 Provider/模型的实际 maximum output；确认后提升 `maxOutputTokens`，同时保持 80% 的独立 context compaction 阈值。
