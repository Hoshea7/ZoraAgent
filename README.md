# Zora

Zora 是一个本地优先的桌面 Agent 工作台。它把项目 Workspace、会话历史、长期记忆、Skills/MCP、多模型 Provider、HITL 权限和飞书远程入口串在一起，让 Agent 可以在真实工作目录里读文件、调用工具、运行命令、写结果，并把关键上下文保存在本机 `.zora/`。

<p align="center">
  <img src="./docs/images/zora-agent-real.png" alt="Zora 真实 Agent 运行过程" width="100%" />
</p>

<p align="center">
  <sub>真实只读运行截图：Zora 在当前仓库中读取 README、package.json 和主进程关键模块，并基于工具调用结果总结产品能力。</sub>
</p>

## 核心能力

| 能力 | 说明 |
|------|------|
| Workspace & Session | 每个工作区绑定一个本地目录，Session 记录用户消息、Agent 输出、工具过程和附件；已发送 Query 可修改并从该位置重新运行。 |
| 真实 Agent Loop | 通过 Runtime Router 分发到 Claude Agent SDK 或 Pi Coding Agent，支持读取/搜索文件、调用工具、运行命令、流式返回过程和结果。 |
| 多 Runtime 会话 | Pi 为当前默认 Runtime，Claude 与 Pi 按轮选择；Zora JSONL 保持跨 Runtime 的产品历史，Runtime checkpoint 仅保存派生执行状态。 |
| 多 Provider | 支持 Anthropic、火山引擎、智谱、Moonshot、DeepSeek 和自定义兼容端点；会话模型和记忆模型可分开配置。 |
| 视觉助手 | 支持图片的主模型直接读取附件；其他模型可以通过用户选择的独立视觉模型调用 Inspect Image，图片能力支持自动识别和 Provider 级覆盖。 |
| 可见子任务 | 父 Agent 可以并行创建探索或审查子任务；每个子任务都是独立可见的会话，具有自己的模型、Runtime、权限状态和完整历史。 |
| Memory Agent | 对话结束后可按 Immediate、Batch 或 Manual 模式整理长期记忆和每日记录。 |
| Skills & MCP | 扫描并导入本机技能目录，支持 `stdio`、`http`、`sse`、`sdk` MCP Server，并内置 Web Search / Web Fetch。 |
| HITL 权限 | Ask、Smart、YOLO 三种权限模式；写文件、运行命令和高风险工具可由用户确认或加入会话白名单。 |
| 飞书远程 | 通过飞书机器人接收私聊/群聊任务，把移动端消息绑定到本地 Workspace 和 Session。 |
| 定时入口 | 桌面端提供定时任务入口，并通过内置 MCP 能力接入 Agent 执行链路。 |

## 架构

<p align="center">
  <img src="./docs/images/zora-architecture.png" alt="Zora 三层架构图" width="100%" />
</p>

这张图的读法不是“模块依赖全景图”，而是 Zora 把一次用户请求变成真实 Agent 执行的主链路：

- **产品体验层**负责入口和状态。桌面端、飞书、定时任务、设置页和权限提示都属于这一层。它让用户发起任务、看见过程、确认风险、接收结果。
- **Agent Harness 层是 Zora 的控制层**。它在调用 Runtime 之前组装产品上下文：选择 Workspace/Session、解析 Provider 和模型、注入记忆、加载 Skills/MCP、套用 HITL 权限策略、绑定飞书会话，并生成一次可执行的 `AgentRequest`。
- **Agent Runtime 层**负责执行。`AgentRuntimeRouter` 按当前轮选择 Claude 或 Pi Adapter，Adapter 调用对应 SDK，并把 SDK 事件转换为统一的 `AgentStreamEvent`；Zora 接收这些事件，把工具步骤、日志、结果和记忆处理继续回流到 UI、飞书和本地 `.zora/`。

Zora 的产品编排决定 Agent 的工作目录、可用工具、模型、推理设置、长期记忆和权限边界；Runtime 只负责执行请求并返回公共事件。

## 产品截图

<table>
  <tr>
    <td width="33%">
      <img src="./docs/images/zora-settings-memory.png" alt="Zora 记忆设置" />
      <br />
      <sub>记忆模式和记忆模型可以独立配置</sub>
    </td>
    <td width="33%">
      <img src="./docs/images/zora-settings-mcp.png" alt="Zora MCP 设置" />
      <br />
      <sub>内置 Web Fetch / Web Search MCP，并支持自定义 Server</sub>
    </td>
    <td width="33%">
      <img src="./docs/images/zora-settings-skills.png" alt="Zora 技能管理" />
      <br />
      <sub>扫描、导入和管理本机 Skills</sub>
    </td>
  </tr>
</table>

## 典型工作流

1. 在桌面端选择或创建 Workspace，让 Zora 绑定一个真实项目目录。
2. 输入任务，选择权限模式和模型；Zora 会创建 Session 并持久化用户消息。
3. Zora Harness 读取当前 Workspace、Provider、Memory、Skills、MCP、权限、模型和推理设置，生成 Runtime 无关的 `AgentRequest`。
4. Agent 运行时把思考、工具调用、工具结果、权限请求和最终回复流式回传到 UI。
5. 任务包含可独立并行的检索或审查工作时，父 Agent 可以创建可见子任务，等待结果后统一回复。
6. 会话结束后，Zora 写入 Session JSONL，并按记忆设置触发 Memory Agent。
7. Pi 长会话达到上下文阈值后会保存压缩 checkpoint；切换会话或重启 App 后，从最近一次完成的压缩边界继续。
8. 如果任务来自飞书，Zora 会把飞书私聊或群聊消息绑定到本地 Session，并把状态和结果回发到飞书。

## 展示 Query 示例

这些 Query 适合用来演示真实能力，可以直接在当前仓库或真实工作区运行：

```text
请基于当前工作区真实读取 README.md、package.json、src/main/session-runner.ts、
src/main/mcp-manager.ts 和 src/main/hitl.ts，不要修改任何文件。

请用产品 README 的视角总结 Zora 当前最值得展示的 6 个能力，
并给出适合截图展示的 query 清单。回复要结构化，能直接指导 README 改写。
```

```text
请先阅读当前仓库的 src/main/query-profiles、src/main/memory-agent.ts
和 src/main/feishu 目录，然后画出 Zora 从桌面/飞书收到任务到 Agent 返回结果的链路。
不要修改文件，只输出结构化说明和 Mermaid 草案。
```

```text
在 Ask 权限模式下，帮我检查 README 里的能力描述是否和当前代码一致。
如果发现不一致，只列出问题和建议补丁，不要直接修改。
```

## 快速开始

### 前置要求

- Bun 1.3+
- Git
- 至少一个可用的模型 API Key 或兼容 Claude/Anthropic 风格接口的网关

### 本地开发启动

```bash
git clone https://github.com/Hoshea7/ZoraAgent.git
cd ZoraAgent
bun install
bun run dev
```

首次启动后，进入 **设置 -> 模型配置** 添加 Provider，填写 API Key、Base URL 和模型。配置完成后即可创建 Workspace 并开始对话；如果当前 Zora 还没有初始化，会先进入唤醒流程。

### 常用命令

```bash
# 开发模式：主进程、渲染进程和 Electron 一起启动
bun run dev

# 类型检查
bun run typecheck

# 全量测试
bun run test

# L1 / L2 分层测试
bun run test:unit
bun run test:integration

# 真实 SDK 诊断
bun run test:live

# 构建主进程和渲染进程
bun run build

# 打包 macOS 版本
bun run dist:mac
```

## 配置

### 模型配置

Zora 在每轮执行前解析 Provider、协议、模型和推理设置，再交给当前 Runtime Adapter 翻译。Provider 可以设置默认模型，也可以配置 SDK 角色模型映射：

- `smallFastModel`：压缩、摘要、轻量任务。
- `sonnetModel`：探索、搜索、常规协作。
- `opusModel`：规划、深度任务。
- `haikuModel`：快速响应。

当前 Runtime 支持范围取决于 Provider 协议：Claude 支持 Anthropic Messages，Pi 支持 Anthropic Messages 和 OpenAI Chat Completions。新会话可以选择 Runtime 和模型；运行中修改从下一轮生效。Memory Agent 仍使用现有独立链路，并可使用独立 Provider 和模型。

Pi 会话在输入框左侧显示上下文占用。占用超过保留区间后，可以从占用详情中手动压缩当前上下文。

### 记忆设置

Zora 支持三种记忆模式：

| 模式 | 适合场景 |
|------|----------|
| Immediate | 每次对话结束后尽快整理记忆。 |
| Batch | 累积多次对话后统一处理，节省 token。 |
| Manual | 只在用户手动触发时处理。 |

记忆内容默认保存在本机 Zora 数据目录中，包括长期记忆、用户画像和每日记录。

### Skills & MCP

技能管理页可以扫描并导入本机其他 Agent 工具中的技能资产，例如 Claude Code、Codex CLI、OpenCode、Gemini CLI 和共享技能目录。

MCP 设置页支持：

- 启用内置 `Web Search` / `Web Fetch`。
- 配置 Tavily / Jina API Key。
- 手动添加自定义 MCP Server。
- 导入或合并 JSON 格式 MCP 配置。
- 测试 MCP Server 连接状态。

### 视觉助手

在 **设置 -> 视觉助手** 中启用视觉中转并选择任意已经配置的模型。主模型的图片能力决定附件路径：

- 已确认支持图片的主模型使用 Runtime 原生 Read，不注册 Inspect Image。
- 图片能力为不支持或未知时，在视觉中转开启且已选择视觉模型的情况下注册 Inspect Image。
- 视觉中转关闭时不注册 Inspect Image，也不增加图片 Read 限制。

视觉模型复用模型配置中的 Provider 地址、协议和密钥。模型配置页允许按 Provider 覆盖自动识别结果。完整运行规则见 [视觉助手设计](./docs/vision-relay-design.md)。

### 子任务委派

普通桌面会话可以创建 `explore` 或 `review` 子任务。子任务继承父会话的工作目录和默认运行目标，也可以选择其他已启用 Provider、模型和 Runtime。子任务权限默认继承父会话，父 Agent 只能请求相同或更严格的权限模式。

子任务显示在父会话下方，用户可以打开完整对话、处理权限请求、修正运行中的消息或停止当前 Run。委派结束后，用户可以把同一子会话作为普通会话继续使用；只有父 Agent 显式继续委派时才会创建新的 delegated run。子任务不会再次创建下一层子任务。delegated run 不触发 Memory Agent，用户直接启动的 desktop run 按普通会话规则处理记忆。图片附件与普通会话使用相同的视觉助手规则。完整运行规则见 [子任务委派设计](./docs/subtask-delegation.md)。

### 飞书设置

在 **设置 -> 飞书** 中填写飞书自建应用的 App ID 和 App Secret，测试连接后即可启动 Bridge。应用需要启用 Bot 能力，并订阅 `im.message.receive_v1` 事件的长连接模式。

当前飞书能力包括：

- WebSocket 长连接，无需公网回调地址。
- 私聊和群聊消息接入；群聊中需要 @ 机器人。
- 飞书会话与 Zora 本地 Session 绑定。
- 支持默认 Workspace 绑定。
- 回复任务状态、交互卡片和打字状态提示。
- 斜杠命令：`/help`、`/new`、`/stop`、`/status`。

### 权限模式

| 模式 | 行为 |
|------|------|
| Ask | 读操作自动放行，写入或高风险操作需要确认。 |
| Smart | 常见读写和编辑操作自动放行，命令类操作按风险继续确认。 |
| YOLO | 尽量自动执行所有操作，适合完全可信的本地任务。 |

当 Agent 需要确认时，Zora 会展示具体工具、命令或文件路径。用户可以允许、拒绝，或把同类操作加入本次会话白名单。

## 本地数据

Zora 的运行数据默认保存在 `~/.zora/`。开发和测试时也可以通过 `ZORA_HOME` 指向隔离目录。

```text
~/.zora/
├── providers.json
├── feishu.json
├── feishu-bindings.json
├── feishu-dedup.json
├── memory-settings.json
├── mcp.json
├── workspaces.json
├── skills/
├── .claude-plugin/
│   └── plugin.json
├── workspaces/
│   └── {workspaceId}/
│       ├── sessions/
│       │   ├── index.json
│       │   ├── {sessionId}.jsonl
│       │   └── attachments/
│       └── delegation-results/
│           └── {delegationId}/{runId}.json
├── runtime-sessions/
│   └── pi/
│       └── {workspaceId}/{sessionId}/*.jsonl  # Pi 派生 checkpoint
└── zoras/
    └── default/
        ├── SOUL.md
        ├── IDENTITY.md
        ├── USER.md
        ├── MEMORY.md
        └── memory/
            └── YYYY-MM-DD.md
```

敏感配置如 API Key、飞书 Secret 和 MCP Key 都保存在本地配置文件中，不应提交到仓库。

## 技术栈

| 分类 | 技术 |
|------|------|
| 桌面框架 | Electron 39 |
| 前端 | React 18 + Vite 7 |
| 状态管理 | Jotai |
| 样式 | Tailwind CSS v4 |
| Agent Runtime | Claude Agent SDK `^0.2.76` + Pi Coding Agent `0.84.1` |
| Runtime 适配 | `AgentRuntimeRouter`、Claude Adapter、Pi Adapter |
| 飞书集成 | `@larksuiteoapi/node-sdk` |
| Markdown / 图表 | react-markdown + remark-gfm + Mermaid |
| 主进程构建 | esbuild |
| 包管理 / 运行脚本 | Bun |
| 语言 | TypeScript |
| 打包 | electron-builder |

## 项目结构

```text
src/
├── main/
│   ├── agent.ts
│   ├── session-runner.ts
│   ├── productivity-runner.ts
│   ├── prompt-builder.ts
│   ├── provider-manager.ts
│   ├── memory-agent.ts
│   ├── session-store.ts
│   ├── workspace-store.ts
│   ├── skill-manager.ts
│   ├── mcp-manager.ts
│   ├── hitl.ts
│   ├── delegation/
│   ├── vision/
│   ├── runtime/
│   │   ├── runtime-router.ts
│   │   ├── claude-adapter.ts
│   │   ├── pi-adapter.ts
│   │   └── pi-session-bridge.ts
│   ├── feishu/
│   └── query-profiles/
├── preload/
├── renderer/
│   ├── components/
│   ├── store/
│   ├── styles/
│   └── utils/
└── shared/
```

## 测试与巡检

```bash
# L1：纯函数和单模块逻辑
bun run test:unit

# L2：多模块集成
bun run test:integration

# 真实 Provider / SDK 诊断
bun run test:live

# 真实 Provider Electron E2E（需本机 ~/.zora/providers.json）
ZORA_E2E_PROVIDER_ID=<provider-id> bun run test:e2e
```

E2E 剧本维护在 `tests/e2e/`，默认使用隔离 HOME；通过后清理测试 HOME，失败时保留截图和 Electron/Renderer 日志。测试用例数量以 `tests/e2e/*.spec.ts` 为准。`qa/gui/` 仅保留历史记录，不再作为测试入口。

## Roadmap

- 微信渠道对接
- Skills 自动进化
- 记忆自动整理和回顾增强
- 权限体系的自动审查模式
- 更完整的真实 Provider E2E 覆盖

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

Copyright © 2026 [Hoshea7](https://github.com/Hoshea7)
