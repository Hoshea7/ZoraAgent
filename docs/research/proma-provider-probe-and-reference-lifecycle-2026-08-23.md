# Proma Provider Probe and Reference Lifecycle Research

Date: 2026-08-23
Scope: read-only inspection of `/Users/bytedance/Desktop/03-code/github_ref/Proma`. This note distinguishes direct code facts from inferences. It does not claim that Proma's implementation satisfies Zora's required product guarantee.

## Conclusion

Proma is already Pi-first for its formal Agent path, but its provider connection test is a separate HTTP probe implementation. It does not construct a Pi `ModelRuntime`, does not create a Pi `AgentSession`, and does not share the formal Agent request construction. Most protocols pass when an endpoint returns HTTP 2xx; only selected providers use a tiny model request. Proma therefore demonstrates useful Pi runtime construction and configuration-reference checks, but it must not be copied as the model-test architecture for Zora.

For configuration references, Proma filters disabled channel/model pairs from selectors, preserves historical session metadata, and lets the user select an alternative model. Its main Agent preflight gives a clear error for a deleted channel. However, the inspected primary Agent path does not reject a disabled channel or disabled/deleted model before running. Provider deletion does not centrally reconcile vision, automations, IM bindings, or historical session records.

## 1. Provider connection test

### Direct facts: UI and IPC chain

1. The settings form tests unsaved values. It selects the first enabled configured model, otherwise the first configured model, otherwise a provider-specific preset for only a subset of providers. The form sends `{ provider, baseUrl, apiKey, modelId? }` to `testChannelDirect`; it has no runtime target, system prompt, conversation context, tool declarations, reasoning level, or cancellation handle.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx:85-106`
   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx:692-712`

2. The preload maps this to the `TEST_DIRECT` IPC handler, and the main IPC handler calls `testChannelDirect(input)` directly.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/preload/index.ts:277-284`
   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/preload/index.ts:1395-1403`
   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/ipc.ts:1341-1354`

3. `testChannel` and `testChannelDirect` are large provider switches in `channel-manager`. They infer a provider from the base URL and call local HTTP-test helpers. This is an implementation distinct from Pi's provider registry.

   - Saved channel: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:563-655`
   - Unsaved form: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:1546-1630`

### Direct facts: request shape and success condition

1. Anthropic-compatible providers, OpenAI-compatible providers, and Google usually use a `GET` models endpoint. Their requests contain only provider-specific authentication headers. For example, the OpenAI-compatible test is `GET resolveOpenAIModelsUrl(baseUrl)` with a Bearer token.

   - Anthropic-compatible GET construction: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:664-695`
   - OpenAI-compatible GET construction: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:856-875`
   - Google GET construction: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:877-889`

2. DeepSeek, Kimi API, Xiaomi, Qwen Token Plan, and Ark Coding Plan instead send a small Anthropic Messages request. The examples use a fixed `"ping"` user message and `max_tokens: 8`; they do not include system/developer content, agent history, tools, reasoning fields, or streaming handling.

   - DeepSeek: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:702-727`
   - Kimi: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:729-757`
   - Xiaomi: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:759-794`
   - Qwen Token Plan: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:796-824`
   - Ark Coding Plan: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:826-853`

3. `normalizeHttpResponse()` declares success for every HTTP 2xx response and does not parse a successful response body. A 2xx response with no assistant output is therefore reported as `连接成功`.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-test-error.ts:224-236`

4. The comments explicitly frame the test as a request that validates API key and connectivity; they do not define it as a formal Agent-runtime availability test.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:558-562`

### Direct facts: formal Pi Agent path

1. Proma's formal Agent orchestration has a single Pi adapter path. The orchestrator reads the channel and credentials, builds product tools and MCP tools, builds dynamic context and system prompt, then passes a complete `PiAgentQueryOptions` object to the adapter.

   - Channel/credential preflight: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:765-821`
   - Pi built-in tools and MCP tools: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:963-992`
   - System prompt construction: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1321-1384`
   - Full Pi query options, including provider, model, credential, base URL, system prompt, custom tools, and Pi session data: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1439-1518`
   - Formal event iteration and zero-visible-response failure rule: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1520-1605` and `1852-1866`

2. `PiAgentAdapter.query()` creates or opens a Pi `SessionManager`, calls the formal `buildModel()`, creates an in-memory Pi settings/resource loader, creates an SDK AgentSession, then subscribes to agent events. This is absent from both connection-test paths.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1254-1315`
   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1321-1425`
   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1480-1605`

3. `buildModel()` is the formal provider adaptation boundary. It derives Pi API protocol, base URL, authentication headers, provider capability compatibility, context window, output cap, and `supportsDeveloperRole`, then registers the provider and model in a Pi `ModelRuntime`.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:530-590`
   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:731-776`

### Assessment

**Direct conclusion:** Proma does not use the formal Pi Agent path for connection tests. The test checks endpoint/auth reachability and, for some providers, a minimal messages endpoint request. It does not prove that the same channel and model can complete a formal Pi Agent turn.

**Inference for Zora:** Do not add provider-specific probe branches modeled on Proma's switch. The long-lived seam should be one Pi probe-runner that uses the same Pi provider/model construction and stream-event interpretation as a formal run. The probe may use a deliberately isolated session and no executable tools, but its request formation must remain in the formal Pi path.

## 2. Deleted or disabled references

### Channel and model selection

1. Proma's generic model selector only lists enabled channels and enabled models. A disabled or deleted reference disappears from the selectable list.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ModelSelector.tsx:39-68`

2. When a user selects a replacement in an Agent session, Proma updates both the per-session mapping and the persisted session metadata, then also updates the global default selection.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/AgentView.tsx:1981-2036`

3. At application startup, Proma clears `agentChannelId` and `agentModelId` only when the saved default channel no longer exists or is disabled. It considers the channel usable from `channel.enabled` alone and does not inspect whether the saved default model is enabled or still exists at this point.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/main.tsx:202-242`

4. If an Agent view lacks a model ID, it picks the first enabled model under the selected enabled channel and persists it as the default. It does not replace an existing but disabled/deleted `agentModelId` through this branch.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/AgentView.tsx:781-811`

### Historical Agent sessions

1. Historical Pi session metadata preserves `channelId` and `modelId`; the fields are not automatically nulled by the metadata type or session initialization.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts:686-705`
   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/AgentView.tsx:464-520`

2. A deleted channel is handled at formal-run preflight. The user sees `渠道不存在` and a non-retryable action to open channel settings and choose another channel.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:765-778`

3. The inspected formal Agent preflight checks only that the channel exists. It does not check `channel.enabled`; after that point it uses the requested `modelId` or a default model directly in `PiAgentQueryOptions`. `buildModel()` registers that supplied model ID without checking `channel.models[].enabled` or that the model is present in the user configuration.

   - No channel-enabled check between lookup and request construction: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:765-895`
   - Direct model forwarding: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1439-1451`
   - Pi registration accepts input model ID: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:731-776`

4. Proma does have a separate strict validator for delegation/fork routes: it requires the channel to exist and be enabled, and requires a matching enabled model. This validator is not called by the primary Agent run path cited above.

   - Validator: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-model-selection.ts:50-75`
   - Fork caller: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.ts:794-804`

**Direct conclusion:** Proma provides a user-visible deleted-channel error and leaves historical transcript metadata intact. It filters inactive choices from the selector, so a user can make a replacement selection. It does not implement the stricter desired invariant that every new run must reject disabled providers and disabled/deleted models.

### Delete action and default selection

1. Main-process `deleteChannel()` only removes the channel from channel config. It does not scan other stores or clear references.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:401-416`

2. The settings page shows a generic irreversible-delete confirmation. After deletion, it clears the global Agent selection only if the deleted channel equals the currently selected Agent channel. It does not inspect vision relay, automations, IM defaults/bindings, or historical session metadata.

   - Confirmation: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelSettings.tsx:67-94` and `173-187`

3. Disabling a channel merely updates `enabled`; no reference cleanup occurs in the settings handler.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelSettings.tsx:96-104`

### Vision relay

1. Vision relay stores an explicit `{ enabled, channelId?, modelId? }`, independent of Agent defaults.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/types/settings.ts:263-271`

2. The vision settings UI lets users choose only enabled channel/model pairs because it uses the generic selector. It persists the explicit pair; it does not subscribe to a channel-delete lifecycle action.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/VisionRelaySettings.tsx:35-74`

3. At execution, a deleted/disabled channel or disabled/missing model returns a visible `VISION_ROUTE_UNAVAILABLE` result instructing the user to reconfigure. It does not automatically change to the global default model.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/vision-relay-service.ts:163-188`

4. The relay is intentionally a specialized minimal request, not the full Agent context: it builds an adapter stream request with empty history and a vision-only system prompt.

   - `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/vision-relay-service.ts:208-235`

**Direct conclusion:** Proma uses a fail-visible/reconfigure behavior for a stale vision route, not the automatic-default fallback proposed for Zora.

### Memory

**Direct fact:** In the searched Proma sources, there is no separate memory-model or memory-channel setting. Memory functionality is created as a Pi built-in tool during ordinary Agent orchestration and receives the active session's channel/model context.

- Pi built-in tool construction with current `channelId` and `modelId`: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:963-980`
- Search scope: all `channelId`/`modelId` references under `apps/electron/src/main`, `apps/electron/src/renderer`, `packages/shared/src`, plus targeted searches for `memory` with either field.

**Gap:** This inspection did not find a Proma analogue of Zora's separately configured memory assistant, so Proma cannot answer how such a reference should be migrated or cleared.

### Other persisted auxiliary references

1. Automations persist `channelId` and optional `modelId`. Their runnable check requires only a non-empty channel ID and workspace ID, and creation/update do not verify existence or enabled state. The scheduler creates or reuses Agent sessions with that stored pair; the run then reaches the ordinary Agent preflight.

   - Types: `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/automation.ts:109-123`
   - Runnable predicate: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/automation-manager.ts:307-310`
   - Create/update behavior: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/automation-manager.ts:441-480` and `484-550`
   - Scheduler session creation: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/automation-scheduler.ts:139-171`

2. Feishu and DingTalk configuration include a `defaultChannelId`; chat bindings also retain a channel/model pair. The inspected command utilities filter inactive choices when rendering a picker, but the channel deletion path does not clear stored defaults/bindings.

   - IM selector filters: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/bridge-model-utils.ts:13-37`
   - Binding display preserves raw IDs when the reference no longer resolves: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/bridge-model-utils.ts:40-61`
   - Feishu effective precedence: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/feishu-bridge.ts:1733-1741`
   - Channel deletion is limited to channel config: `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:401-416`

**Inference:** A stale automation or IM reference will either fail at a later runtime step or remain displayed as a raw ID. The exact end-user text for every bridge path was not exhaustively traced, so this should be verified before using it as a product-behavior claim.

## Recommendation for Zora

1. Make **Pi the only model-test runtime target**. The test input should resolve the same Pi target used by a formal Zora session: provider identity, protocol, model ID, base URL, credentials, Pi protocol compatibility, default context window/output cap, and reasoning configuration. Avoid retaining a Claude test implementation or a provider-specific HTTP test switch.

2. Add one isolated Pi probe mode beneath the shared formal Pi assembly boundary. It should use a temporary session directory, no persisted conversation, empty user history, formal static system/developer role construction, the formal stream parser, and declared-but-non-executable tools. Its success rule should require normal terminal completion plus non-empty expected assistant content. It must not accept HTTP 2xx or stream creation alone.

3. Define one `resolveRunnableProviderModel` predicate used by the renderer selector, Agent run preflight, probe runner, vision, memory, automation, and bridge dispatch. For every **new** run: provider exists and is enabled; model exists and is enabled. Existing session history remains readable; an unavailable current target blocks sending and directs the user to choose another enabled model.

4. At provider/model deletion, calculate all impacted references before confirmation. The confirmation should list default Agent target, vision target, memory target, automations, and external-bridge bindings. On confirmation, clear each affected reference. Do not silently redirect specialized auxiliary workloads to the global default: a default Agent model may not support vision, may carry different privacy/cost properties, or may be inappropriate for memory. If a product requirement later permits a fallback, make it an explicit per-feature policy and validate capabilities before save/run.

5. Treat disabled and deleted references identically for *new dispatch* and selector visibility. Preserve the historical identifier only as historical metadata. Present the unavailable state on the session and retain the replacement-selection control.
