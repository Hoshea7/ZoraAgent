# 模型参数上提到 Harness 层 + 推理强度 UI 方案

## 问题现状

模型相关参数分散在三个地方，且不统一：

| 参数 | 当前位置 | 当前值 | 可配置 |
|---|---|---|---|
| maxTurns | Harness `limits` | 120 (productivity) / 7 (memory) | 否，硬编码在 Profile |
| maxTokens | Pi Adapter `buildPiModel()` 硬编码 | 16384 | 否 |
| reasoning | Pi Adapter `buildPiModel()` 硬编码 | false | 否 |
| contextWindow | Pi Adapter `buildPiModel()` 硬编码 | 128000 | 否 |
| temperature | 无 | 走 SDK 默认 | 否 |
| thinking budget | 无 | 走 SDK 默认 | 否 |

核心问题：Adapter 硬编码了本应由 Harness 声明的模型参数意图，Claude 侧完全没有模型参数控制。

---

## 设计原则

沿用已确认的架构层次：

```
Harness（数据契约，声明 profile 要什么）
  → Adapter（翻译层，把意图翻译成具体 Runtime 的 API 格式）
    → Runtime Loop
```

- **Harness 声明意图**：maxTurns、maxOutputTokens、reasoningEffort，这些是"这个 profile 跑任务时需要多少资源"的声明，跟用哪个 Runtime 无关
- **Adapter 负责翻译**：Claude 侧映射到 SDK 参数，Pi 侧映射到 Model 对象
- **模型固有属性（contextWindow 等）跟着 Provider/Model 走**，不跟着 Profile 走，留在 Adapter 或 ProviderConfig 层

---

## 改动清单

### 1. Harness 层：扩展 `AgentHarnessSpec.limits`

**文件**：`src/main/agent-profiles/types.ts`

```typescript
// 推理强度枚举
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface HarnessLimits {
  /** Agent 工具调用轮次上限 */
  maxTurns: number;
  /** 单次输出 token 上限 */
  maxOutputTokens: number;
  /** 推理强度 */
  reasoningEffort: ReasoningEffort;
}
```

**文件**：`src/main/agent-profiles/productivity-profile.ts`

```typescript
const PRODUCTIVITY_LIMITS = {
  maxTurns: 120,
  maxOutputTokens: 16_384,
  reasoningEffort: "medium" as const,
};
```

ProductivityProfile.prepare() 中，limits 不再硬编码，而是允许从外部传入覆盖：

```typescript
export interface ProductivityProfileInput {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  cwd: string;
  permissionMode: "default" | "bypassPermissions";
  // 新增：用户在前端调整的模型参数覆盖
  modelOverrides?: Partial<HarnessLimits>;
}
```

最终 limits 合并逻辑：`{ ...DEFAULT_LIMITS, ...input.modelOverrides }`

**文件**：`src/main/agent-profiles/memory-profile.ts`

```typescript
const MEMORY_LIMITS = {
  maxTurns: 7,
  maxOutputTokens: 8_192,
  reasoningEffort: "low" as const,
};
```

Memory profile 不接受外部覆盖（后台静默运行，不需要用户调参）。

### 2. Adapter 层：翻译 Harness 参数

#### 2a. Pi Adapter

**文件**：`src/main/runtime/pi-session-bridge.ts`

`buildPiModel()` 不再硬编码，改为接收 harness limits：

```typescript
function buildPiModel(
  config: PiProviderConfig,
  limits: HarnessLimits
): Model<any> {
  return {
    id: config.model,
    name: config.model,
    api: config.api,
    provider: config.providerId,
    baseUrl: config.baseUrl,
    // reasoning Effort 映射到 Pi 的 boolean + 后续可扩展
    reasoning: limits.reasoningEffort !== "none",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000, // 模型固有属性，暂保留在 Adapter，未来可移到 ProviderConfig
    maxTokens: limits.maxOutputTokens,
  };
}
```

`PiSessionBridge.getOrCreateAgent()` 和 `createPiSession()` 需要透传 limits 参数。

session identity 需要加入 limits 维度，否则切换参数不会创建新 session：

```typescript
function sessionIdentity(config, workingDirectory, limits): string {
  return JSON.stringify([
    config.api, config.baseUrl, config.apiKey, config.model,
    config.providerId, workingDirectory,
    limits.maxOutputTokens, limits.reasoningEffort, // 新增
  ]);
}
```

**文件**：`src/main/runtime/pi-adapter.ts`

PiRuntimeAdapter.start() 中，把 harness.limits 传给 sessionBridge：

```typescript
agent = await this.sessionBridge.getOrCreateAgent(
  input.harness.sessionId,
  providerConfig,
  input.harness.workspace.cwd,
  input.harness.limits,  // 新增
);
```

#### 2b. Claude Adapter

**文件**：`src/main/query-profiles/productivity.ts`

`buildProductivityProfile()` 中，把 harness limits 翻译成 Claude SDK 参数：

```typescript
const options: QueryProfile["options"] = {
  // ... 现有参数
  maxTurns: ctx.maxTurns ?? 120,
  // 新增：传给 SDK 的模型参数
  maxOutputTokens: ctx.maxOutputTokens,  // 映射到 SDK max_tokens
  reasoningEffort: ctx.reasoningEffort,  // 映射到 SDK thinking budget
};
```

**文件**：`src/main/query-profiles/types.ts`

`ProfileBuildContext` 新增字段：

```typescript
export interface ProfileBuildContext {
  // ... 现有字段
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}
```

**文件**：`src/main/productivity-runner.ts`

`buildRunProfile()` 中，从 harness.limits 读取并传给 ProfileBuildContext：

```typescript
const profile = await buildProductivityProfile({
  // ... 现有参数
  maxTurns: harness.limits.maxTurns,
  maxOutputTokens: harness.limits.maxOutputTokens,
  reasoningEffort: harness.limits.reasoningEffort,
});
```

Claude SDK 的 reasoningEffort 映射规则：
- `none` → 不启用 thinking
- `low` → thinking budget = 4,096
- `medium` → thinking budget = 10,240
- `high` → thinking budget = 32,768

具体实现位置取决于 Claude Agent SDK 的 API 形态。如果 SDK 通过环境变量控制（如 `MAX_THINKING_TOKENS`），则在 env 中注入；如果通过 options 传，则在 options 中设置。

### 3. 前端 UI：推理强度选择器

#### 3a. 状态管理

**文件**：`src/renderer/store/workspace.ts`

新增 draft 状态原子，跟 `draftRuntimeTypeAtom` 同级：

```typescript
// 新会话草稿态的推理强度
export const draftReasoningEffortAtom = atom<ReasoningEffort>("medium");
```

`resetWorkspaceSurface()` 和 `startNewChatAtom` 中同步重置：

```typescript
function resetWorkspaceSurface(set: Setter): void {
  // ... 现有重置
  set(draftReasoningEffortAtom, "medium");
}
```

#### 3b. Session 持久化

**文件**：`src/shared/zora.d.ts`

`SessionMeta` 新增字段：

```typescript
export interface SessionMeta {
  // ... 现有字段
  reasoningEffort?: ReasoningEffort;
}
```

已有会话切换推理强度时，通过 `window.zora.setSessionReasoningEffort()` 持久化（需要在 IPC 层新增对应方法），或复用现有的 `updateSessionMeta` 机制。

#### 3c. UI 组件

**新建文件**：`src/renderer/components/chat/ReasoningEffortSelector.tsx`

组件设计：
- 放置位置：ChatInput 底部工具栏，RuntimeSelector 右侧
- 交互形态：DropdownMenu，与 RuntimeSelector 风格一致（圆角 pill button + 下拉菜单）
- 选项：无 / 低 / 中 / 高（none / low / medium / high）
- 默认值：medium
- 当前选中态高亮，与 ModelSelector/RuntimeSelector 保持一致的视觉语言

```
[附件] [权限] | [模型选择器] | [Runtime: Pi ▾] [思考: 中 ▾]    [发送]
```

组件结构参考 `RuntimeSelector.tsx`：

```tsx
const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: "关闭",
  low: "低",
  medium: "中",
  high: "高",
};

export function ReasoningEffortSelector() {
  // 读取当前 session 或 draft 的 reasoningEffort
  // 切换时：session 模式持久化，draft 模式更新原子
  // 样式与 RuntimeSelector 一致
}
```

#### 3d. ChatInput 集成

**文件**：`src/renderer/components/chat/ChatInput.tsx`

在底部工具栏 RuntimeSelector 后面插入 ReasoningEffortSelector：

```tsx
<div className="ml-1 h-4 w-px shrink-0 bg-stone-200" />
<RuntimeSelector />
<div className="ml-1 h-4 w-px shrink-0 bg-stone-200" />
<ReasoningEffortSelector />
```

### 4. 参数传递链路

完整链路（从前端到 Runtime）：

```
前端 ReasoningEffortSelector
  → draftReasoningEffortAtom / session.reasoningEffort
    → createSession / send message 时，reasoningEffort 作为 session 元数据传递
      → ProductivityProfile.prepare(input) 中读取，合并到 harness.limits
        → AgentHarnessSpec.limits.reasoningEffort
          → Claude Adapter: 翻译成 SDK thinking budget
          → Pi Adapter: 翻译成 Model.reasoning
```

具体传递路径：

1. **新会话（draft 模式）**：用户在 ChatInput 调整 reasoningEffort → `draftReasoningEffortAtom` → 发送消息时创建 session 并写入 `reasoningEffort` → 构建 harness 时传入
2. **已有会话**：用户调整 → `window.zora.setSessionReasoningEffort(sessionId, effort, workspaceId)` → 更新 session meta → 下一轮对话构建 harness 时读取
3. **Harness 构建**：`ProductivityProfile.prepare()` 接收 `modelOverrides`，合并默认值后写入 `harness.limits`
4. **Adapter 消费**：Claude/Pi Adapter 从 `input.harness.limits` 读取，翻译成各自 Runtime 的参数格式

### 5. 不在本次范围内的

- `temperature` / `topP` / `topK`：暂不上 Harness，这些参数对 Agent 场景意义有限，且不同 Runtime 支持差异大。如果后续需要，可以按同样模式扩展。
- `contextWindow`：模型固有属性，未来应该移到 ProviderConfig 或 Model 能力声明中，不在 Harness 层。
- 前端 UI 只做 reasoningEffort 的可调节控制。maxOutputTokens 保持 Harness 默认值，不暴露给前端（用户不需要关心具体 token 数）。

---

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/main/agent-profiles/types.ts` | 修改 | 新增 ReasoningEffort 类型，扩展 HarnessLimits |
| `src/main/agent-profiles/productivity-profile.ts` | 修改 | limits 改为可接受外部覆盖 |
| `src/main/agent-profiles/memory-profile.ts` | 修改 | limits 补充新字段，不接受覆盖 |
| `src/main/runtime/pi-session-bridge.ts` | 修改 | buildPiModel 接收 limits，session identity 加入 limits |
| `src/main/runtime/pi-adapter.ts` | 修改 | 透传 harness.limits 给 sessionBridge |
| `src/main/query-profiles/types.ts` | 修改 | ProfileBuildContext 新增字段 |
| `src/main/query-profiles/productivity.ts` | 修改 | 翻译 limits 到 SDK 参数 |
| `src/main/productivity-runner.ts` | 修改 | 从 harness.limits 读取传给 profile |
| `src/shared/zora.d.ts` | 修改 | SessionMeta 新增 reasoningEffort |
| `src/renderer/store/workspace.ts` | 修改 | 新增 draftReasoningEffortAtom |
| `src/renderer/components/chat/ReasoningEffortSelector.tsx` | 新建 | 推理强度选择器组件 |
| `src/renderer/components/chat/ChatInput.tsx` | 修改 | 集成 ReasoningEffortSelector |
| IPC 层（main process session handler） | 修改 | 新增 setSessionReasoningEffort 方法 |

---

## 执行顺序建议

1. **Harness 层类型扩展** — types.ts + 两个 profile 文件，确保编译通过
2. **Pi Adapter 翻译** — pi-session-bridge.ts + pi-adapter.ts，Pi 侧跑通
3. **Claude Adapter 翻译** — query-profiles/types.ts + productivity.ts + productivity-runner.ts
4. **前端状态管理** — workspace.ts + zora.d.ts
5. **前端 UI 组件** — ReasoningEffortSelector.tsx + ChatInput.tsx 集成
6. **IPC 层** — session 持久化 reasoningEffort

每步完成后可独立验证编译和基本功能。
