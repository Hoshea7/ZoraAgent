import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentStreamEvent } from "@/shared/zora";

const tempHomes = new Set<string>();
const moduleIds = {
  agentExecutionService: path.resolve(process.cwd(), "src/main/agent-execution-service.ts"),
  agentRuntime: path.resolve(process.cwd(), "src/main/runtime/index.ts"),
  delegationService: path.resolve(process.cwd(), "src/main/delegation/service.ts"),
  hitl: path.resolve(process.cwd(), "src/main/hitl.ts"),
  mcpManager: path.resolve(process.cwd(), "src/main/mcp-manager.ts"),
  memoryAgent: path.resolve(process.cwd(), "src/main/memory-agent.ts"),
  modelCapabilityService: path.resolve(process.cwd(), "src/main/model-capability-service.ts"),
  runtimeExecutionTarget: path.resolve(
    process.cwd(),
    "src/main/runtime/runtime-execution-target.ts"
  ),
  toolProvisioning: path.resolve(process.cwd(), "src/main/runtime/tool-provisioning.ts"),
  visionSettings: path.resolve(process.cwd(), "src/main/vision-settings.ts"),
};

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-delegation-sync-int-"));
  tempHomes.add(homeDir);
  return homeDir;
}

async function loadDelegationRunner(homeDir: string) {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  vi.doMock(moduleIds.agentExecutionService, () => ({
    agentExecutionService: {
      execute: vi.fn(async (input: { forwardEvent: (event: AgentStreamEvent) => void }) => {
        input.forwardEvent({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "zora" }] },
        });
        return { status: "completed", finalText: "zora" };
      }),
    },
  }));
  vi.doMock(moduleIds.agentRuntime, () => ({
    agentRuntimeRouter: { deleteSessionData: vi.fn() },
  }));
  vi.doMock(moduleIds.delegationService, () => ({
    delegationCoordinator: {},
  }));
  vi.doMock(moduleIds.hitl, () => ({
    setPermissionMode: vi.fn(),
  }));
  vi.doMock(moduleIds.mcpManager, () => ({
    getSharedMcpManager: () => ({ getEditableConfig: vi.fn(async () => ({ servers: {} })) }),
  }));
  vi.doMock(moduleIds.memoryAgent, () => ({
    memoryAgent: { scheduleProcessing: vi.fn() },
  }));
  vi.doMock(moduleIds.modelCapabilityService, () => ({
    createRuntimeModelCapabilityResolver: () => ({
      resolve: () => "unsupported",
    }),
  }));
  vi.doMock(moduleIds.runtimeExecutionTarget, () => ({
    resolveAgentRuntimeTarget: vi.fn(async () => ({
      agentRuntimeType: "pi",
      protocol: "openai-completions",
      modelId: "model-1",
      contextWindow: 200_000,
      provider: {
        id: "provider-1",
        name: "Provider",
        providerType: "custom",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        contextWindow: 200_000,
      },
    })),
  }));
  vi.doMock(moduleIds.toolProvisioning, () => ({
    createToolProvisioningPlan: vi.fn(() => ({ tools: [] })),
  }));
  vi.doMock(moduleIds.visionSettings, () => ({
    visionSettingsStore: {
      load: vi.fn(async () => ({
        capabilityOverrides: {},
        relay: { enabled: false },
      })),
    },
  }));

  return {
    sessionStore: await import("@/main/session-store"),
    sessionRunner: await import("@/main/session-runner"),
  };
}

afterEach(() => {
  vi.doUnmock("node:os");
  for (const moduleId of Object.values(moduleIds)) {
    vi.doUnmock(moduleId);
  }
  vi.resetModules();
  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("delegation session sync", () => {
  it("emits the persisted delegation prompt before the child assistant stream", async () => {
    const workspaceId = "default";
    const prompt = "读取当前项目 package.json，报告 name 字段";
    const { sessionRunner, sessionStore } = await loadDelegationRunner(createTempHome());
    const session = await sessionStore.createSession("Package inspector", workspaceId);
    const sessionId = session.id;
    await sessionStore.updateSessionMeta(
      sessionId,
      {
        providerId: "provider-1",
        providerLocked: true,
        selectedModelId: "model-1",
        agentRuntimeType: "pi",
      },
      workspaceId
    );

    const events: AgentStreamEvent[] = [];
    await sessionRunner.runPromptInSession({
      sessionId,
      workspaceId,
      text: prompt,
      source: "delegation",
      waitForCompletion: true,
      forwardEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.type)).toEqual(["session_sync", "assistant"]);
    expect(events[0]).toMatchObject({
      type: "session_sync",
      source: "delegation",
      workspaceId,
      session: { id: sessionId, title: "Package inspector" },
      messages: [{ role: "user", text: prompt }],
    });
  });
});
