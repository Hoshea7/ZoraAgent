# 已发送 Query 编辑与重新发送调研

日期：2026-08-14

## 范围

本报告只分析以下本地仓库的源码、项目文档和测试：

- Proma，commit `447169c791c4`
- CodePilot，commit `891f8e89e154`
- deepseek-harness，commit `47f943859bef`

调研内容包括已发送用户消息编辑、后续历史处理、停止当前生成、重新发送、会话持久化、provider/runtime 上下文和工具副作用。ZoraAgent 将调研材料放在 `docs/research/`；当前文档入口同时规定运行时与会话行为以源码和 E2E 测试为准：[ZoraAgent/docs/README.md:3](/Users/bytedance/Desktop/03-code/ZoraAgent/docs/README.md:3)、[ZoraAgent/docs/README.md:11](/Users/bytedance/Desktop/03-code/ZoraAgent/docs/README.md:11)。

## 结论

| 项目 | 已发送用户消息编辑 | 截断后续历史 | 停止生成 | 编辑后重新发送 | runtime 上下文同步 |
|---|---|---|---|---|---|
| Proma Chat | 已实现 | 已实现 | 已实现 | 已实现 | Chat 模式不使用 Pi 会话 artifact |
| Proma Pi Agent | 未实现 | 仅支持按已完成 assistant 节点回退 | 已实现 | 未实现 | assistant 节点回退时同步 Pi branch artifact |
| CodePilot | 未实现 | Native rewind 会删除目标之后的数据库消息；SDK rewind 只恢复文件 | 已实现 | 仅有追加式 retry | 不支持历史用户消息编辑后的 runtime 重建 |
| deepseek-harness | 未实现 | 已实现持久化分支，可从已完成 turn 边界派生子会话 | 已实现 | 未提供用户消息编辑入口 | 分支继承请求 header、provider、model、reasoning effort 和工具组合 |

三者中，Proma Chat 提供了最接近目标交互的完整实现。Agent 产品的数据模型参考以 deepseek-harness 更完整。它保留原会话，以稳定事件前缀创建子会话，避免直接改写已经被 runtime 消费的历史。Proma Pi 的展示记录与 Pi artifact 同步切换也说明，单独删除 UI 或产品 JSONL 会造成上下文不一致：[agent-session-manager.ts:858](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.ts:858)、[api-proxy.ts:2415](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts:2415)。

## Proma

### Chat 模式

Proma Chat 的用户消息操作栏提供重新发送和编辑按钮：[ChatMessageItem.tsx:269](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatMessageItem.tsx:269)、[ChatMessageItem.tsx:284](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatMessageItem.tsx:284)。进入编辑态时记录消息 ID，流式生成期间拒绝进入编辑态：[ChatView.tsx:514](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:514)。编辑表单支持已有附件、新附件、Enter 提交和 Escape 取消：[InlineEditForm.tsx:28](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/InlineEditForm.tsx:28)、[InlineEditForm.tsx:190](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/InlineEditForm.tsx:190)、[InlineEditForm.tsx:267](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/InlineEditForm.tsx:267)。

提交编辑时，renderer 先截断目标消息及其后的历史，再处理附件，最后复用正常发送路径：[ChatView.tsx:525](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:525)、[ChatView.tsx:535](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:535)、[ChatView.tsx:556](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:556)。不修改文本的重新发送也采用截断后发送：[ChatView.tsx:497](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:497)。

主进程以目标消息为起点切分记录，删除目标及后续消息，并全量覆写 JSONL：[conversation-manager.ts:319](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/conversation-manager.ts:319)、[conversation-manager.ts:343](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/conversation-manager.ts:343)、[conversation-manager.ts:357](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/conversation-manager.ts:357)。删除分支的附件会同步清理，重发流程可临时保留目标用户消息附件：[conversation-manager.ts:346](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/conversation-manager.ts:346)。

停止生成通过当前会话的 `AbortController` 执行：[chat-service.ts:549](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/chat-service.ts:549)。已经输出的 assistant 内容以 `stopped: true` 持久化，随后发送完成事件：[chat-service.ts:454](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/chat-service.ts:454)、[chat-service.ts:459](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/chat-service.ts:459)。用户消息在请求开始前写入会话 JSONL，正常回复和中止回复也写入同一持久化链路：[chat-service.ts:238](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/chat-service.ts:238)、[chat-service.ts:430](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/chat-service.ts:430)。

该实现存在原子性问题。截断、附件处理和发送由 renderer 依次调用；附件保存或新请求启动失败时，旧分支已经从磁盘删除且没有自动恢复：[ChatView.tsx:525](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:525)。Zora 不应复制这个多 IPC 顺序。

### Pi Agent 模式

Pi Agent 的用户消息只提供复制操作，没有 edit、resend、delete 或 rewind 回调：[SDKMessageRenderer.tsx:1066](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx:1066)、[SDKMessageRenderer.tsx:1457](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx:1457)。`onFork` 和 `onRewind` 只挂在 assistant turn：[SDKMessageRenderer.tsx:1481](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx:1481)。因此 Proma 的完整 Chat 编辑功能没有覆盖 Pi Agent 主链。

Pi 回退接口接收 `assistantMessageUuid`，保留目标 assistant 消息并删除其后内容：[agent.ts:1210](/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts:1210)。执行时会同时截断展示 JSONL、创建 Pi branch artifact、过滤 entry bindings，并更新 `sdkSessionId` 与 `piSessionFile`：[agent-session-manager.ts:858](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.ts:858)、[agent-session-manager.ts:899](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.ts:899)。映射只记录 assistant UUID 到 Pi entry ID：[agent.ts:695](/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts:695)、[pi-agent-adapter.ts:1514](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1514)。第一条用户 query、没有 assistant 结果的 query 和任意用户消息边界无法由现有接口表达。

停止期间 renderer 保持运行状态，等待主进程完成，避免底层 query 未退出时启动重复 run：[AgentView.tsx:2323](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/AgentView.tsx:2323)。orchestrator 调用 adapter abort，Pi adapter 同时停止压缩与 Agent 执行，中止路径仍持久化累计消息：[agent-orchestrator.ts:2044](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:2044)、[pi-agent-adapter.ts:1895](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1895)、[agent-orchestrator.ts:1883](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1883)。主进程还会拒绝运行中会话的回退请求：[agent-orchestrator.ts:2122](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:2122)。

普通续聊从元数据读取 `sdkSessionId`，存在时恢复 Pi artifact，不存在时用 Proma JSONL 回填历史：[agent-orchestrator.ts:878](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:878)、[agent-orchestrator.ts:1032](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1032)。Pi adapter 使用 `SessionManager.open` 打开已有 artifact：[pi-agent-adapter.ts:1305](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1305)。因此只截断 Proma JSONL 会让 Pi 继续携带旧上下文。

Pi 回退当前没有恢复工作区文件。orchestrator 返回 `canRewind: false`：[agent-orchestrator.ts:2114](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:2114)。编辑 query 后隐藏旧消息不会撤销旧回复期间完成的文件修改或外部调用。

## CodePilot

CodePilot 没有已发送用户消息编辑入口。用户消息 footer 只渲染复制按钮：[MessageItem.tsx:961](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/MessageItem.tsx:961)。消息列表可附加的额外操作只有文件 checkpoint 的 rewind 按钮：[MessageList.tsx:80](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/MessageList.tsx:80)、[MessageList.tsx:480](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/MessageList.tsx:480)。项目虽然有更新消息内容的 API，但源码明确说明它用于把图片生成请求替换为结果，没有截断后续历史或重建 runtime 的语义：[messages/route.ts:41](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/messages/route.ts:41)、[db.ts:3119](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/db.ts:3119)。

CodePilot 的 retry 查找最近一条用户消息，并再次调用正常发送函数：[ChatView.tsx:850](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/ChatView.tsx:850)、[ChatView.tsx:917](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/ChatView.tsx:917)。切换模型、扩大上下文后的 retry 也会追加同一文本：[ChatView.tsx:898](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/ChatView.tsx:898)、[ChatView.tsx:909](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/ChatView.tsx:909)。该行为保留原消息和原回复，不满足替换分支的语义。

rewind 有两条路径。活跃 SDK conversation 调用 `rewindFiles()` 并直接返回，没有删除产品数据库消息；Native 路径删除目标之后的消息并恢复文件 checkpoint：[rewind/route.ts:8](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/rewind/route.ts:8)、[rewind/route.ts:24](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/rewind/route.ts:24)、[rewind/route.ts:34](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/rewind/route.ts:34)、[rewind/route.ts:48](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/rewind/route.ts:48)。SDK rewind point 也以文件 checkpoint 为用途，只为 prompt 级用户消息发出：[claude-client.ts:2490](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/claude-client.ts:2490)。因此它不能作为跨 runtime 的消息编辑接口。

停止功能覆盖 Native、Codex runtime 和 SDK conversation：[interrupt/route.ts:6](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/interrupt/route.ts:6)、[interrupt/route.ts:55](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/interrupt/route.ts:55)。客户端在请求中断前安排强制 abort，避免 interrupt 请求挂起后界面长期处于 active：[stream-session-manager.ts:1040](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/stream-session-manager.ts:1040)、[stream-session-manager.ts:1058](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/stream-session-manager.ts:1058)。用户主动停止还会清空待发送队列，该行为有回归测试：[ChatView.tsx:1085](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/components/chat/ChatView.tsx:1085)、[stream-stop-and-error-honesty.test.ts:71](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/__tests__/unit/stream-stop-and-error-honesty.test.ts:71)。

用户消息在 runtime 启动前写入 SQLite，随后从数据库加载历史并排除刚写入的最后一条消息：[chat/route.ts:327](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/route.ts:327)、[chat/route.ts:544](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/route.ts:544)、[chat/route.ts:552](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/app/api/chat/route.ts:552)。Claude SDK 在有 `sdkSessionId` 时恢复已有会话，只有 fresh/fallback 路径才把数据库历史拼回 prompt：[claude-client.ts:1839](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/claude-client.ts:1839)、[claude-client.ts:2099](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/claude-client.ts:2099)。Codex runtime 也会根据持久化 thread ref、provider 和 MCP fingerprint 恢复 thread：[codex/runtime.ts:800](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/codex/runtime.ts:800)、[codex/runtime.ts:817](/Users/bytedance/Desktop/03-code/github_ref/CodePilot/src/lib/codex/runtime.ts:817)。直接修改 SQLite 消息不会删除 runtime thread 中已经存在的旧 query 和回复。

## deepseek-harness

deepseek-harness 明确没有已发送用户消息编辑入口。用户消息只传入文本和时间操作，测试断言用户气泡没有 branch 和 edit 按钮：[MessageItem.tsx:237](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/client/ui-conversation/src/client/chat/MessageItem.tsx:237)、[chat-branch-tails.client.spec.tsx:83](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx:83)。它可以编辑尚未进入 durable turn 的 inbox 项，host 只调用 `agent.inbox.replace`：[api-proxy.ts:2609](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts:2609)。该能力不覆盖已发送 query。

它的核心会话是追加式事件日志，消息历史由日志派生：[types.ts:230](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/types.ts:230)。`SessionStore.fork` 从稳定前缀创建子会话，记录 `parentSession` 和 `seedLength`，并拒绝位于 open turn 内的边界：[index.ts:1067](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/index.ts:1067)、[index.ts:1081](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/index.ts:1081)、[index.ts:1128](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/index.ts:1128)。测试验证子会话 seed 与源日志相互独立、早期已完成 turn 可在源会话仍有 open tail 时分支，并接受 stopped、error、max-token 和 interrupted 等结束原因：[fork.spec.ts:79](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/tests/fork.spec.ts:79)、[fork.spec.ts:117](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/tests/fork.spec.ts:117)、[fork.spec.ts:137](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/tests/fork.spec.ts:137)。fork seed 可通过 JSONL 持久化并恢复：[jsonl.spec.ts:566](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/session/session-persistence-jsonl/tests/jsonl.spec.ts:566)。

host 的 fork 会把锚点推进到包含它的首个 `turn/end`，避免切入未完成 turn；没有闭合边界时返回 `fork-unavailable`：[api-proxy.ts:2378](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts:2378)、[api-proxy.ts:2390](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts:2390)。测试分别覆盖停止后的 turn 可分支和 open turn 被拒绝：[api-proxy-fork.spec.ts:226](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/tests/api-proxy-fork.spec.ts:226)、[api-proxy-fork.spec.ts:243](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/tests/api-proxy-fork.spec.ts:243)。当前 UI 只在已完成 assistant turn 尾部显示 branch，并切换到新子会话：[TurnTailNodeView.tsx:11](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/client/ui-conversation/src/client/chat/TurnTailNodeView.tsx:11)、[TurnTailNodeView.tsx:45](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/client/ui-conversation/src/client/chat/TurnTailNodeView.tsx:45)、[apply.ts:417](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts:417)。要支持编辑 query，锚点应改为该 query 之前的已完成 turn，并补充空会话根边界。

停止按钮调用 session cancel；host 使用 `keepInbox: true`，中止当前 phase 并保留尚未消费的队列：[apply.ts:343](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts:343)、[api-proxy.ts:2618](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts:2618)、[agent.ts:134](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/agent-loop/src/agent.ts:134)。崩溃恢复会为未闭合的工具结果、step 和 turn 追加确定性的结束事件，并把 turn 标记为 interrupted：[repair.ts:18](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/repair.ts:18)、[repair.ts:89](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/repair.ts:89)、[repair.ts:126](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/repair.ts:126)。这套 closed-turn 规则适合定义停止后编辑的安全边界。

每个请求 header 持久化 provider、model、reasoning effort、system prompt 和工具 schema：[types.ts:196](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/types.ts:196)、[types.ts:201](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/types.ts:201)、[types.ts:304](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/session/src/types.ts:304)。Agent 恢复并比较该 header，按 initial、resume 或 change 追加新快照：[agent.ts:417](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/agent-loop/src/agent.ts:417)、[agent.ts:458](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/core/agent-loop/src/agent.ts:458)。host fork 还会继承源会话的工具组合：[api-proxy.ts:2415](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts:2415)。测试确认 provider、model 和 reasoning effort 在子会话首次运行前已经恢复：[api-proxy-fork.spec.ts:256](/Users/bytedance/Desktop/03-code/github_ref/deepseek-harness/packages/host/apiproxy/tests/api-proxy-fork.spec.ts:256)。

## Zora 采用的设计

### 数据语义

采用线性替换语义。编辑已发送 query 会保留目标消息 ID、时间和附件，替换其文本，并删除该消息之后的用户消息、assistant turn、工具结果和队列记录。当前产品没有历史版本切换入口，持久化隐藏分支会增加会话模型、附件引用和运行时恢复的复杂度，且没有对应用户能力。

这项设计依据有三项：

1. Proma Chat 已验证线性截断与重新发送的交互和持久化语义：[ChatView.tsx:525](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:525)、[conversation-manager.ts:319](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/conversation-manager.ts:319)。
2. Zora 的 JSONL 是跨 runtime 的产品主记录。删除 Pi checkpoint，并清除 `sdkSessionId` 和 context window 状态后，Pi 与 Claude 均可从截断后的产品历史重建上下文。
3. deepseek-harness 的持久化分支适用于需要版本导航和原分支恢复的产品。Zora 当前没有这项需求。若以后增加历史版本切换，应将其作为完整的分支功能设计，不能继续扩展线性替换接口。

### 主进程用例

由一个主进程命令编排以下操作，renderer 不组合多个破坏性 IPC：

1. 运行中的会话拒绝编辑。用户停止并收到终态后，编辑入口重新启用。
2. 验证目标属于当前会话且为用户消息。
3. 删除 Runtime checkpoint，清除 `sdkSessionId` 和 context window 状态，禁止后续运行恢复旧上下文。
4. 在会话写队列中原子替换 JSONL，保留目标之前的稳定前缀，替换目标 query，删除后续记录。
5. 更新附件 manifest，保留前缀与目标 query 引用的附件，再删除不受引用的附件文件。manifest 更新失败时恢复原 JSONL。
6. 使用会话当前锁定的 provider、model、reasoning effort、权限模式和工作目录，以及当前有效的工具配置，从产品历史重建 runtime 上下文并运行新 query。

Proma Chat 由 renderer 依次调用截断、附件处理和发送。Zora 把持久化重写、运行时失效和重新运行放入一个主进程用例，避免 UI 组合多段破坏性操作。

### 交互

- 用户消息 hover 时显示编辑按钮。运行中点击编辑时，界面先进入停止中状态，收到主进程终态后再显示内联编辑框。Proma Chat 当前选择在流式期间禁用编辑；Proma Pi 保持 running 直到停止真正完成，两项行为可组合：[ChatView.tsx:514](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ChatView.tsx:514)、[AgentView.tsx:2323](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/AgentView.tsx:2323)。
- 内联编辑框修改文本并原样保留目标消息附件，提供取消和发送。当前功能不在编辑器中增删附件。Proma 已验证这一交互结构：[InlineEditForm.tsx:28](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/InlineEditForm.tsx:28)。
- 发送后，当前界面和持久化记录只保留修改后的线性历史。
- 编辑历史 query 不自动撤销已执行的工具副作用。文件修改、终端进程、外部消息和 API 请求需要独立的 checkpoint 或人工确认。Proma Pi 的会话回退没有文件恢复能力：[agent-orchestrator.ts:2114](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:2114)。

### 必测场景

- 已完成回复后编辑最近 query，重新加载应用后仍只恢复新分支。
- 生成中点击编辑，停止完成后再发送，确保旧 run 不继续写入。
- 编辑第一条 query，验证空根边界。
- 编辑带附件 query，验证目标消息附件保留，后续记录独占附件被清理。
- Claude 与 Pi 分别验证新 runtime 不包含旧 query 和旧 assistant 回复。
- 保持会话锁定的 provider、model、reasoning effort、权限模式和工作目录，工具使用当前有效配置。
- transcript 修改成功但新 turn 启动失败，界面重新加载已修改的持久化历史，并允许再次发送。
- 工具产生文件修改或外部副作用后编辑，界面明确说明会话分支与副作用恢复的范围。

## 最终判断

Proma 的普通 Chat 模式提供了最接近目标的线性编辑流程。CodePilot 提供停止、追加式 retry 和部分 rewind 原语。deepseek-harness 的稳定 turn 边界和 runtime 配置继承用于校验上下文重建规则。Zora 采用单主进程用例、原子 JSONL 替换、附件清理和 runtime 状态失效，保持 Pi 与 Claude 的上下文一致。
