# Zora Provider 适配层设计方案

> 状态：Draft v1
> 日期：2026-08-11
> 作者：Zora

## 1. 问题背景

### 1.1 报错现象

配置阿里云 Maas Anthropic 兼容端点时，qwen3.8-max 模型报 400 错误：

```
"reasoning_effort" and "thinking_budget" cannot be set simultaneously
```

2 个模型连接成功（glm-5.2、deepseek-v4-flash），1 个失败（qwen3.8-max）。

### 1.2 根因定位

`src/main/runtime/claude-model-config.ts` 中的 `toClaudeReasoningOptions` 函数：

```typescript
export function toClaudeReasoningOptions(level: ReasoningLevel) {
  if (level === "off") {
    return { thinking: { type: "disabled" } };
  }
  return {
    thinking: { type: "adaptive" },
    effort: level, // "high" | "max"
  };
}
```

当 reasoning level 不为 off 时，**同时设置了 `thinking` 和 `effort`**。Claude Agent SDK 将 `thinking` 翻译为 `thinking_budget` 参数，将 `effort` 翻译为 `reasoning_effort` 参数。官方 Anthropic API 接受两者共存，但阿里云 Maas 的 Anthropic 兼容端点拒绝。

**根因不是某个参数写错了，而是 Zora 的 Provider 层缺少参数适配机制**：所有 Provider 走同一条路径、用同一套参数，没有按 Provider/Model 的实际能力做差异化处理。

### 1.3 为什么现在才暴露

Zora 之前的预设主要面向火山引擎和官方 Anthropic，这两者都能正常处理 `thinking + effort` 组合。阿里云 Maas 是新接入的 Provider，它的 Anthropic 兼容端点对参数校验更严格，暴露了这个设计缺失。

---

## 2. 现状分析

### 2.1 Zora 当前 Provider 架构

```
ProviderConfig (flat config)
  ├── id, name, providerType, baseUrl, apiKey
  ├── modelId, roleModels (角色模型映射)
  ├── presetId → ProviderPreset (仅 id/label/providerType/protocol/defaultUrl)
  ├── protocol: "anthropic-messages" | "openai-completions"
  ├── contextWindow
  └── enabled, isDefault

数据流：
  ProviderConfig
    → buildProviderSdkEnv() → 环境变量注入 Claude SDK 子进程
    → buildPiProvider() → Pi ModelRuntime 注册
    → toClaudeReasoningOptions() → Claude SDK Options (thinking + effort)
    → toThinkingLevel() → Pi thinkingLevel
```

### 2.2 核心缺陷

| 缺陷 | 影响 |
|------|------|
| **Preset 信息过薄** | 只有 protocol 和 defaultUrl，不包含任何能力声明 |
| **无模型目录** | 模型只是一个字符串 ID，没有能力元数据（reasoning/vision/effort 支持） |
| **无参数适配层** | `toClaudeReasoningOptions` 对所有 Provider 一视同仁，不区分官方 vs 第三方 |
| **能力检测硬编码** | `MAINTAINED_IMAGE_MODELS` 手写模型列表，新增模型必须改代码 |
| **Reasoning 翻译过于简单** | 只有 off/high/max 三档，不区分 adaptive/manual/effort-only 等模式 |

### 2.3 当前文件矩阵

| 文件 | 职责 |
|------|------|
| `shared/types/provider.ts` | ProviderConfig 类型定义 |
| `shared/provider-presets.ts` | 预设目录（10 个预设） |
| `shared/provider-protocol.ts` | 协议解析（默认 anthropic-messages） |
| `shared/provider-model.ts` | 模型 ID 解析 |
| `shared/runtime-capabilities.ts` | Runtime 协议支持矩阵 |
| `shared/model-capability.ts` | 图片输入能力检测（手写模型列表） |
| `main/provider-manager.ts` | Provider CRUD + 测试连接 |
| `main/runtime/claude-model-config.ts` | Reasoning → Claude SDK Options 翻译 |
| `main/runtime/pi-session-bridge.ts` | Pi 运行时会话桥接 |
| `main/runtime/pi-provider-registry.ts` | Pi Provider 注册 |
| `main/runtime/runtime-execution-target.ts` | 运行时目标解析 |
| `main/query-profiles/productivity.ts` | 生产力 Profile 构建（调用 toClaudeReasoningOptions） |

---

## 3. 参考项目调研

### 3.1 三个项目的架构对比

| 维度 | CodePilot | Proma | Cindy |
|------|-----------|-------|-------|
| **核心模式** | Catalog → Resolver → 双路径输出 | Adapter Registry + 纯逻辑适配器 | Catalog SSoT + 数据驱动路由 |
| **预设数量** | 28+ VendorPreset | 22 ProviderType | 19 ProviderPreset |
| **协议抽象** | 9 种 Protocol | 4 种适配器（Anthropic/OpenAI/Responses/Google） | 3 种 WireProtocol |
| **能力声明** | 模型级 capabilities + wireCapabilities | ThinkingCapability + ReasoningProfile | CatalogModel capabilities + Effort 系统 |
| **参数冲突** | 模型族匹配 + sanitizer 规则 | detectThinkingCapability 按 modelId 分 5 种模式 | Effort 统一抽象，per-agent 翻译 |
| **模型目录** | CatalogModel[] 含 upstreamModelId 映射 | ChannelModel[] 含 source 来源 | CatalogModel[] per-agent 嵌套 |
| **测试连接** | 7 探针诊断引擎 + Live Probe | 按 protocol 分 3 条路径 + 错误分类 | 同路由口径探测 + SSE 首帧检查 |

### 3.2 各项目值得借鉴的设计

#### CodePilot

1. **CatalogModel.capabilities**：每个模型声明 `supportsEffort`、`supportsAdaptiveThinking`、`thinkingMode`、`supportedEffortLevels`，参数适配有据可依
2. **wireCapabilities 与 UI capabilities 分离**：传输层能力和展示层能力分开声明
3. **modelId / upstreamModelId 分离**：UI 用短别名，API 用真实 ID
4. **Call Scene Policy**：`interactive_only` 的 Provider 在后台任务中被拦截

#### Proma

1. **ReasoningProfile 系统**：跨协议的推理档位，每个 profile 通过 `effortMap` 将通用档位映射为供应商特定值
2. **detectThinkingCapability**：按 modelId 匹配，返回 `adaptive-only`/`adaptive-preferred`/`manual-only`/`effort-based-max`/`none`
3. **适配器是纯逻辑**：不执行 I/O，只做数据转换，可独立单元测试
4. **构造参数化复用**：一个 AnthropicAdapter 类通过构造参数服务 15 种供应商

#### Cindy

1. **Catalog 是 SSoT**："加新供应商 = 加路由数据，不改路由器代码"
2. **per-agent 模型嵌套**：同一 model id 在不同 agent 下元数据可不同
3. **Effort 统一抽象**：7 档（minimal ~ ultra），底层参数由 agent runtime 翻译
4. **预设快照语义**：选中即快照进用户配置，之后与预设脱钩

### 3.3 三个项目的共识

尽管实现方式不同，三个项目在以下方面达成共识：

1. **模型有能力元数据**，不只是字符串 ID
2. **参数适配由数据驱动**，不是代码 if-else
3. **Reasoning 有统一抽象层**，底层参数按 Provider/Model/Protocol 差异化翻译
4. **预设包含完整信息**：协议、认证方式、默认模型、能力声明

---

## 4. 设计目标

### 4.1 核心目标

1. **解决参数冲突**：不同 Provider 的 reasoning 参数适配由数据驱动，不硬编码
2. **模型有能力声明**：每个模型可以声明自己支持的 reasoning 模式、effort 档位等
3. **预设信息丰富化**：Preset 包含足够的信息支撑参数适配
4. **Pi 优先**：设计以 Pi runtime 为核心，Claude runtime 保持兼容

### 4.2 设计约束

遵循项目编码原则：

- 选能满足当前需求的最简单实现，不预防性抽象
- 先跑通最小端到端版本，再往上加
- 优先用成熟的、有人维护的库
- 架构决策往长了做，不接受"先这样以后再换"的临时方案

### 4.3 不做什么

- 不自建 HTTP 客户端（继续用 SDK 的 query/stream）
- 不做 Provider Call Scene Policy（当前没有 interactive_only 的场景）
- 不做 modelId/upstreamModelId 分离（当前模型 ID 直接透传，没有 alias 需求）
- 不做密钥加密体系重构（当前 storeSecret 够用）

---

## 5. 方案设计

### 5.1 架构总览

```
ProviderConfig (用户配置)
  ├── presetId → ProviderPreset (增强)
  │                 ├── protocol, defaultUrl (现有)
  │                 ├── reasoningTransport ← 新增：reasoning 参数传输模式
  │                 └── models: CatalogModel[] ← 新增：模型目录
  │
  ├── modelId, roleModels (现有)
  └── protocol, baseUrl, apiKey (现有)

ReasoningAdapter (新增)
  输入：provider, modelId, reasoningLevel, runtime
  输出：runtime-specific reasoning 参数
    ├── Claude SDK: { thinking, effort } | { thinking } | { effort } | {}
    └── Pi: { thinkingLevel } | {}
```

### 5.2 ProviderPreset 增强

```typescript
// shared/types/provider.ts

/**
 * Reasoning 参数的传输模式。
 * 不同 Provider 的 Anthropic 兼容端点对 reasoning 参数的支持不同，
 * 通过此字段声明正确的传输方式。
 */
export type ReasoningTransport =
  | "anthropic-native"   // 官方 Anthropic：thinking + effort 可共存
  | "thinking-only"      // 仅支持 thinking_budget（部分第三方端点）
  | "effort-only"        // 仅支持 reasoning_effort（部分第三方端点）
  | "adaptive-only"      // 仅支持 adaptive thinking（Opus 4.7+ 等）
  | "none";              // 不支持 reasoning

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  providerType: ProviderType;
  protocol: ProviderProtocol;
  defaultUrl: string;
  description?: string;
  // ── 新增 ──
  /** Reasoning 参数传输模式，默认 "anthropic-native" */
  reasoningTransport?: ReasoningTransport;
  /** 该预设的默认模型目录 */
  models?: CatalogModelEntry[];
}
```

### 5.3 模型目录条目

```typescript
// shared/types/provider.ts

/**
 * 模型目录条目。声明单个模型的能力元数据。
 * 来源：预设内置 或 用户自定义。
 */
export interface CatalogModelEntry {
  /** 模型 ID，直接透传给 API */
  modelId: string;
  /** 展示名称 */
  displayName?: string;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 支持的推理模式 */
  reasoning?: {
    /** 是否支持 reasoning */
    enabled: boolean;
    /** 支持的 effort 档位 */
    effortLevels?: ReasoningLevel[];
    /** 思考模式 */
    thinkingMode?: "adaptive" | "manual" | "always";
  };
  /** 输入模态 */
  input?: ("text" | "image")[];
  /** 是否支持工具调用 */
  toolUse?: boolean;
}
```

### 5.4 ReasoningAdapter

这是核心的参数适配层，替代当前 `toClaudeReasoningOptions` 的硬编码逻辑。

```typescript
// main/runtime/reasoning-adapter.ts

import type { ReasoningLevel, ReasoningTransport, ProviderConfig } from "../../shared/types/provider";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * 解析 Provider 的 reasoning 传输模式。
 * 优先用 preset 声明的值，回退到根据 baseUrl 推断。
 */
export function resolveReasoningTransport(
  provider: Pick<ProviderConfig, "presetId" | "baseUrl">
): ReasoningTransport {
  // 1. 从 preset 查
  if (provider.presetId) {
    const preset = PROVIDER_PRESETS[provider.presetId];
    if (preset?.reasoningTransport) {
      return preset.reasoningTransport;
    }
  }

  // 2. 根据 baseUrl 推断
  const isOfficialAnthropic = provider.baseUrl === "https://api.anthropic.com"
    || provider.baseUrl === "";
  return isOfficialAnthropic ? "anthropic-native" : "thinking-only";
}

// ── Claude SDK 路径 ──

type ClaudeReasoningOptions = Pick<Options, "thinking" | "effort">;

export function toClaudeReasoningOptions(
  level: ReasoningLevel,
  transport: ReasoningTransport
): ClaudeReasoningOptions {
  if (level === "off") {
    return { thinking: { type: "disabled" } };
  }

  switch (transport) {
    case "anthropic-native":
      // 官方端点：thinking + effort 可共存
      return {
        thinking: { type: "adaptive" },
        effort: level,
      };

    case "thinking-only":
      // 仅支持 thinking_budget，不发 effort
      return {
        thinking: { type: "adaptive" },
      };

    case "effort-only":
      // 仅支持 reasoning_effort，不发 thinking
      return {
        effort: level,
      };

    case "adaptive-only":
      // 仅支持 adaptive thinking
      return {
        thinking: { type: "adaptive" },
      };

    case "none":
      // 不支持 reasoning
      return { thinking: { type: "disabled" } };
  }
}

// ── Pi 路径 ──

export function toPiThinkingLevel(
  level: ReasoningLevel,
  transport: ReasoningTransport
): "high" | "max" | undefined {
  if (level === "off" || transport === "none") return undefined;
  return level;
}
```

### 5.5 调用点改造

#### 5.5.1 Claude 路径：`query-profiles/productivity.ts`

```typescript
// 改造前
import { toClaudeReasoningOptions } from "../runtime/claude-model-config";
// ...
...toClaudeReasoningOptions(ctx.reasoningLevel ?? "high"),

// 改造后
import { toClaudeReasoningOptions, resolveReasoningTransport } from "../runtime/reasoning-adapter";
// ...
const transport = ctx.executionTarget
  ? resolveReasoningTransport({
      presetId: ctx.executionTarget.provider.presetId as ProviderPresetId | undefined,
      baseUrl: ctx.executionTarget.provider.baseUrl,
    })
  : "anthropic-native";
...toClaudeReasoningOptions(ctx.reasoningLevel ?? "high", transport),
```

#### 5.5.2 Pi 路径：`runtime/pi-session-bridge.ts`

```typescript
// 改造前
function toThinkingLevel(level: ReasoningLevel): "high" | "max" | undefined {
  if (level === "off") return undefined;
  return level;
}
// ...
thinkingLevel: toThinkingLevel(modelTuning.reasoningLevel),

// 改造后
import { toPiThinkingLevel, resolveReasoningTransport } from "./reasoning-adapter";
// ...
const transport = resolveReasoningTransport({
  presetId: providerConfig.presetId,
  baseUrl: providerConfig.baseUrl,
});
thinkingLevel: toPiThinkingLevel(modelTuning.reasoningLevel, transport),
```

#### 5.5.3 测试连接：`provider-manager.ts`

测试连接时同样需要传入正确的 reasoning 参数。`performTestConnection` 和 `performOpenAIConnectionTest` 中的 reasoning 参数也需要适配。

### 5.6 预设更新

```typescript
// shared/provider-presets.ts

export const PROVIDER_PRESETS: Record<ProviderPresetId, ProviderPreset> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    providerType: "anthropic",
    protocol: "anthropic-messages",
    defaultUrl: "https://api.anthropic.com",
    reasoningTransport: "anthropic-native",
  },
  "volcengine-compatible": {
    id: "volcengine-compatible",
    label: "火山引擎（Anthropic 兼容）",
    providerType: "volcengine",
    protocol: "anthropic-messages",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/compatible",
    reasoningTransport: "anthropic-native", // 火山引擎支持 thinking + effort
  },
  "volcengine-coding-plan": {
    id: "volcengine-coding-plan",
    label: "火山 Coding Plan",
    providerType: "volcengine",
    protocol: "anthropic-messages",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/coding",
    reasoningTransport: "anthropic-native",
  },
  "volcengine-agent-plan-anthropic": {
    id: "volcengine-agent-plan-anthropic",
    label: "火山 Agent Plan（Anthropic）",
    providerType: "volcengine",
    protocol: "anthropic-messages",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/plan",
    reasoningTransport: "anthropic-native",
  },
  "volcengine-agent-plan-openai": {
    id: "volcengine-agent-plan-openai",
    label: "火山 Agent Plan（OpenAI）",
    providerType: "volcengine",
    protocol: "openai-completions",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    reasoningTransport: "effort-only", // OpenAI 协议用 reasoning_effort
  },
  zhipu: {
    id: "zhipu",
    label: "智谱 AI",
    providerType: "zhipu",
    protocol: "openai-completions",
    defaultUrl: "https://open.bigmodel.cn/api/paas/v4",
    reasoningTransport: "effort-only",
  },
  moonshot: {
    id: "moonshot",
    label: "Kimi",
    providerType: "moonshot",
    protocol: "openai-completions",
    defaultUrl: "https://api.moonshot.cn/v1",
    reasoningTransport: "none", // Kimi 当前不支持 reasoning
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    providerType: "deepseek",
    protocol: "openai-completions",
    defaultUrl: "https://api.deepseek.com",
    reasoningTransport: "none", // DeepSeek 通过 <think> 标签，不走标准参数
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    providerType: "openai",
    protocol: "openai-completions",
    defaultUrl: "https://api.openai.com/v1",
    reasoningTransport: "effort-only",
  },
  custom: {
    id: "custom",
    label: "自定义",
    providerType: "custom",
    protocol: "openai-completions",
    defaultUrl: "",
    description: "协议与接口地址需要由用户明确配置。",
    // 自定义 Provider 默认走 thinking-only（更安全）
    reasoningTransport: "thinking-only",
  },
};
```

### 5.7 新增阿里云 Maas 预设

当前阿里云 Maas 使用的是 `custom` 预设或某个已有预设。应该新增专门的预设：

```typescript
// 在 ProviderPresetId 中新增
| "aliyun-maas-anthropic"
| "aliyun-maas-openai"

// 预设定义
"aliyun-maas-anthropic": {
  id: "aliyun-maas-anthropic",
  label: "阿里云百炼（Anthropic 兼容）",
  providerType: "custom",
  protocol: "anthropic-messages",
  defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  reasoningTransport: "thinking-only", // 关键：不发 effort
  description: "阿里云百炼 Maas Anthropic 兼容端点。",
},

"aliyun-maas-openai": {
  id: "aliyun-maas-openai",
  label: "阿里云百炼（OpenAI 兼容）",
  providerType: "custom",
  protocol: "openai-completions",
  defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  reasoningTransport: "effort-only",
  description: "阿里云百炼 Maas OpenAI 兼容端点。",
},
```

> 注意：报错截图中的 URL 是 `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`，这是阿里云 Token Plan 的端点。如果需要单独支持，可以再加一个预设 `aliyun-token-plan-anthropic`。

### 5.8 PiProviderConfig 传递 presetId

当前 `PiProviderConfig` 不包含 `presetId`，需要补充：

```typescript
// main/runtime/pi-provider-registry.ts

export interface PiProviderConfig {
  api: PiApi;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  contextWindow: number;
  presetId?: ProviderPresetId; // ← 新增
}

export function buildPiProvider(target: AgentRuntimeTarget): PiProviderConfig {
  return {
    api: target.protocol === "anthropic-messages" ? "anthropic-messages" : "openai-completions",
    baseUrl: target.provider.baseUrl,
    apiKey: target.provider.apiKey,
    model: target.modelId,
    providerId: target.provider.id,
    contextWindow: target.contextWindow,
    presetId: target.provider.presetId, // ← 新增
  };
}
```

同时 `RuntimeProviderTarget` 也需要带上 `presetId`：

```typescript
// main/runtime/runtime-execution-target.ts

interface RuntimeProviderTarget {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  roleModels?: RoleModels;
  contextWindow: number;
  presetId?: ProviderPresetId; // ← 新增
}
```

---

## 6. 实施计划

### Phase 1: 紧急修复（解决报错）

**目标**：让 qwen3.8-max 不再报 400 错误。

**改动范围**：

1. 新建 `src/main/runtime/reasoning-adapter.ts`
   - `resolveReasoningTransport()`：根据 baseUrl 推断 transport
   - `toClaudeReasoningOptions(level, transport)`：按 transport 适配参数
   - `toPiThinkingLevel(level, transport)`：Pi 路径适配

2. 修改 `src/main/runtime/claude-model-config.ts`
   - 标记为 deprecated，内部委托给 reasoning-adapter

3. 修改 `src/main/query-profiles/productivity.ts`
   - 传入 executionTarget，解析 transport，传给 reasoning options

4. 修改 `src/main/runtime/pi-session-bridge.ts`
   - 用 `toPiThinkingLevel` 替代 `toThinkingLevel`

5. 修改 `src/main/runtime/pi-provider-registry.ts`
   - `PiProviderConfig` 增加 `presetId`

6. 修改 `src/main/runtime/runtime-execution-target.ts`
   - `RuntimeProviderTarget` 增加 `presetId`

7. 修改 `src/shared/provider-presets.ts`
   - 给现有预设补充 `reasoningTransport`
   - 新增阿里云 Maas 预设

8. 修改 `src/shared/types/provider.ts`
   - 新增 `ReasoningTransport` 类型
   - `ProviderPreset` 增加 `reasoningTransport` 和 `models` 字段

**验收标准**：
- 阿里云 Maas Anthropic 端点 + qwen3.8-max 测试连接成功
- 官方 Anthropic + 火山引擎行为不变
- 现有所有测试通过

### Phase 2: 模型目录（后续迭代）

**目标**：为预设内置模型目录，支持模型级能力查询。

**改动范围**：

1. 新增 `CatalogModelEntry` 类型定义
2. 给每个预设补充 `models: CatalogModelEntry[]`
3. 新建 `src/shared/model-catalog.ts`
   - `getModelCapabilities(provider, modelId)` → 查找模型能力
   - `listAvailableModels(presetId)` → 列出预设可用模型
4. 改造 `src/shared/model-capability.ts`
   - `ModelCapabilityResolver` 从模型目录读取能力，替代手写 `MAINTAINED_IMAGE_MODELS`
5. UI 改造：Provider 编辑表单中模型选择从文本输入改为下拉选择

### Phase 3: 高级能力（按需迭代）

- Provider 级别的能力覆盖（用户可手动调整某个 Provider 的 reasoningTransport）
- 模型级别的 reasoningTransport 覆盖（同一 Provider 不同模型支持不同模式）
- 测试连接的 reasoning 参数对齐（测试时也用适配后的参数）
- 自动模型发现（从 `/v1/models` 端点拉取可用模型列表）

---

## 7. 测试计划

### 7.1 单元测试 (L1)

```
tests/unit/main/runtime/reasoning-adapter.test.ts
```

- `resolveReasoningTransport`：各 presetId 返回正确的 transport
- `resolveReasoningTransport`：baseUrl 推断逻辑（官方 vs 第三方）
- `toClaudeReasoningOptions`：各 transport × 各 level 的组合
- `toPiThinkingLevel`：各 transport × 各 level 的组合

### 7.2 集成测试 (L2)

```
tests/integration/provider-reasoning.test.ts
```

- Provider 配置 → runtime target → reasoning transport 解析链路
- Preset 切换后 reasoning transport 正确更新

### 7.3 E2E 测试 (L3)

```
tests/e2e/provider-config.spec.ts
```

- 添加阿里云 Maas Provider → 填入 qwen3.8-max → 测试连接成功
- 添加官方 Anthropic Provider → reasoning level 切换 → 正常对话

---

## 8. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| reasoningTransport 推断不准 | 中 | 提供手动覆盖入口；默认走 thinking-only（更保守） |
| 现有 Provider 缺少 presetId | 低 | resolveReasoningTransport 有 baseUrl 回退逻辑 |
| 新增字段影响配置迁移 | 低 | reasoningTransport 和 models 都是 optional，旧配置不受影响 |
| Pi SDK 对 thinkingLevel 的处理差异 | 中 | toPiThinkingLevel 保持和现有 toThinkingLevel 一致的行为 |

---

## 9. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/shared/types/provider.ts` | 修改 | 新增 ReasoningTransport、CatalogModelEntry 类型；ProviderPreset 增加字段 |
| `src/shared/provider-presets.ts` | 修改 | 补充 reasoningTransport；新增阿里云预设 |
| `src/main/runtime/reasoning-adapter.ts` | **新建** | 核心适配逻辑 |
| `src/main/runtime/claude-model-config.ts` | 修改 | 委托给 reasoning-adapter |
| `src/main/runtime/pi-session-bridge.ts` | 修改 | 用 toPiThinkingLevel 替代 toThinkingLevel |
| `src/main/runtime/pi-provider-registry.ts` | 修改 | PiProviderConfig 增加 presetId |
| `src/main/runtime/runtime-execution-target.ts` | 修改 | RuntimeProviderTarget 增加 presetId |
| `src/main/query-profiles/productivity.ts` | 修改 | 传入 transport 给 reasoning options |
| `src/main/provider-manager.ts` | 修改 | 测试连接时适配 reasoning 参数 |
| `tests/unit/main/runtime/reasoning-adapter.test.ts` | **新建** | L1 单元测试 |

---

## 附录 A：三个参考项目的详细调研

### A.1 CodePilot

**架构**：Catalog → Resolver → 双路径输出（env / SDK config）

**核心设计**：
- 28+ VendorPreset，每个包含完整的协议、认证、模型目录、能力声明
- `CatalogModel.capabilities` 声明 `supportsEffort`、`supportsAdaptiveThinking`、`thinkingMode`、`supportedEffortLevels`
- `wireCapabilities` 声明传输层能力，与 UI 能力分离
- `toClaudeCodeEnv()` 构建环境变量，`toAiSdkConfig()` 构建 SDK 配置
- 7 探针诊断引擎 + Call Scene Policy

**参数冲突处理**：
- 模型族匹配（EFFORT_FAMILY_PATTERNS）按正则匹配允许的 effort 等级
- 自适应思考模型族不接受手动 extended thinking，自动转为 adaptive
- sampling 参数（temperature/topP/topK）在自适应思考模型族上被 strip

### A.2 Proma

**架构**：Adapter Registry + 纯逻辑适配器

**核心设计**：
- 22 种 ProviderType，通过 `adapterRegistry` 映射到 4 个适配器类
- 适配器是纯逻辑：`buildStreamRequest()` 输出 url + headers + body，`parseSSELine()` 解析 SSE
- `ReasoningProfile` 系统：6 个预设 profile，通过 `effortMap` 映射通用档位到供应商特定值
- `detectThinkingCapability(providerType, modelId)` 返回 5 种思考模式
- `streamSSE()` 通用 SSE 读取器 + 首字节前重试策略

**参数冲突处理**：
- `detectThinkingCapability` 按 modelId 匹配，返回 adaptive-only / adaptive-preferred / manual-only / effort-based-max / none
- 适配器在 `buildStreamRequest` 中根据能力选择唯一一种思考协议，不会同时发送互斥参数

### A.3 Cindy

**架构**：Catalog SSoT + 数据驱动路由

**核心设计**：
- `Provider` 包含 `agents[]`（支持哪些 runtime）、`routing`（per-agent 路由描述符）、`models`（per-agent 模型清单）
- `RoutingDescriptor` 把上游地址、鉴权策略、header 处理全部数据化
- `buildRouteDecision()` 是纯 switch-case 翻译器
- 6 种 AuthStrategy（oauth-passthrough / provider-oauth-header / api-key-header / gateway-key / oauth-token / none）
- 预设是纯 UI 模板，选中后快照进用户配置
- 目录加载容错链：dev 本地 → 公共 API → LKG 缓存 → 旧 OSS → 内置 bundled

**参数冲突处理**：
- Effort 统一抽象（7 档），底层参数由 agent runtime 翻译
- `clampEffortToSupported()` 确保存量任务里存的档位不会发给不支持的模型
- 不在 catalog 层做参数互斥检测，由 per-agent 透传处理
