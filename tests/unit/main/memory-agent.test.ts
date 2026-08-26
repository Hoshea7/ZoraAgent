import type { ConversationMessage } from "@/shared/zora";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemorySettings,
} from "@/shared/types/memory";
import path from "node:path";

const agentModuleId = path.resolve(process.cwd(), "src/main/agent.ts");
const memorySettingsModuleId = path.resolve(process.cwd(), "src/main/memory-settings.ts");
const memoryStoreModuleId = path.resolve(process.cwd(), "src/main/memory-store.ts");
const queryProfilesModuleId = path.resolve(process.cwd(), "src/main/query-profiles/index.ts");
const sdkRuntimeModuleId = path.resolve(process.cwd(), "src/main/sdk-runtime.ts");
const sessionStoreModuleId = path.resolve(process.cwd(), "src/main/session-store.ts");

const DEFAULT_TEST_MEMORY_SETTINGS: MemorySettings = {
  ...DEFAULT_MEMORY_SETTINGS,
  mode: "batch" as const,
};

function createMessages(label: string): ConversationMessage[] {
  return [
    {
      id: `${label}-user-1`,
      role: "user",
      text: `${label} user asks`,
      timestamp: 1,
    },
    {
      id: `${label}-assistant-1`,
      role: "assistant",
      timestamp: 2,
      turn: {
        id: `${label}-turn-1`,
        processSteps: [],
        bodySegments: [{ id: `${label}-body-1`, text: `${label} reply` }],
        status: "done",
        startedAt: 2,
        completedAt: 3,
      },
    },
    {
      id: `${label}-user-2`,
      role: "user",
      text: `${label} user follows up`,
      timestamp: 4,
    },
    {
      id: `${label}-assistant-2`,
      role: "assistant",
      timestamp: 5,
      turn: {
        id: `${label}-turn-2`,
        processSteps: [],
        bodySegments: [{ id: `${label}-body-2`, text: `${label} second reply` }],
        status: "done",
        startedAt: 5,
        completedAt: 6,
      },
    },
  ];
}

async function loadMemoryAgentRuntime(
  settingsOverride: Partial<MemorySettings> = {}
) {
  vi.resetModules();

  const memorySettings = {
    ...DEFAULT_TEST_MEMORY_SETTINGS,
    ...settingsOverride,
  };
  const runAgentWithProfile = vi.fn(async () => ({
    lateQueuedMessages: [],
    sdkSessionId: undefined,
  }));
  const loadMemorySettings = vi.fn(async () => memorySettings);
  const getMemorySettingsSync = vi.fn(() => memorySettings);
  const buildMemoryProfile = vi.fn(async ({ harness }: { harness: { prompt: { user: string }; workspace: { cwd: string }; budget: { maxTurns: number } } }) => ({
    name: "memory",
    prompt: harness.prompt.user,
    options: {
      cwd: harness.workspace.cwd,
      maxTurns: harness.budget.maxTurns,
    },
  }));
  const loadMessages = vi.fn(async (sessionId: string) => createMessages(sessionId));
  const listSessions = vi.fn(async (workspaceId = "default") => [
    {
      id: `${workspaceId}-session`,
      title: `${workspaceId} title`,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    },
  ]);

  vi.doMock(agentModuleId, () => ({
    isAgentRunningForSession: vi.fn(() => false),
    runAgentWithProfile,
  }));
  vi.doMock(memorySettingsModuleId, () => ({
    getMemorySettingsSync,
    loadMemorySettings,
  }));
  vi.doMock(memoryStoreModuleId, () => ({
    getZoraMemoryDirPath: vi.fn(() => "/tmp/zora-memory"),
    loadFile: vi.fn(async (fileName: string) => `${fileName} current content`),
  }));
  vi.doMock(queryProfilesModuleId, () => ({
    buildMemoryProfile,
  }));
  vi.doMock(sdkRuntimeModuleId, () => ({
    getSDKRuntimeOptions: vi.fn(() => ({
      executable: "node",
      executableArgs: [],
      pathToClaudeCodeExecutable: "/tmp/fake-claude",
      env: {},
    })),
  }));
  vi.doMock(sessionStoreModuleId, () => ({
    listSessions,
    loadMessages,
  }));

  return {
    module: await import("@/main/memory-agent"),
    mocks: {
      buildMemoryProfile,
      listSessions,
      loadMessages,
      runAgentWithProfile,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock(agentModuleId);
  vi.doUnmock(memorySettingsModuleId);
  vi.doUnmock(memoryStoreModuleId);
  vi.doUnmock(queryProfilesModuleId);
  vi.doUnmock(sdkRuntimeModuleId);
  vi.doUnmock(sessionStoreModuleId);
  vi.resetModules();
});

describe("main memory-agent", () => {
  it("skips memory queueing and processing when memory is disabled", async () => {
    const {
      module: { MemoryAgent },
      mocks,
    } = await loadMemoryAgentRuntime({ enabled: false });
    const agent = new MemoryAgent();

    agent.scheduleProcessing("disabled-session", "workspace-a");
    await agent.onConversationEnd("disabled-session", "workspace-a");
    const result = await agent.processNow();

    expect(result).toEqual({ total: 0, processed: 0 });
    expect(agent.getPendingCount()).toBe(0);
    expect(mocks.loadMessages).not.toHaveBeenCalled();
    expect(mocks.runAgentWithProfile).not.toHaveBeenCalled();
  });

  it("keeps batch memory processing scoped to each workspace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T09:30:00+08:00"));

    const {
      module: { MemoryAgent },
      mocks,
    } = await loadMemoryAgentRuntime();
    const agent = new MemoryAgent();

    await agent.onConversationEnd("workspace-a-session", "workspace-a");
    await agent.onConversationEnd("workspace-b-session", "workspace-b");
    const result = await agent.processNow();

    expect(result).toEqual({ total: 2, processed: 2 });
    expect(mocks.listSessions).toHaveBeenCalledWith("workspace-a");
    expect(mocks.listSessions).toHaveBeenCalledWith("workspace-b");
    expect(mocks.runAgentWithProfile).toHaveBeenCalledTimes(2);
    expect(mocks.runAgentWithProfile.mock.calls.map((call) => call[4])).toEqual([
      "workspace-a",
      "workspace-b",
    ]);
    expect(mocks.buildMemoryProfile.mock.calls.map((call) => call[0].harness.prompt.user)).toEqual([
      expect.stringContaining("**Session**: workspace-a title"),
      expect.stringContaining("**Session**: workspace-b title"),
    ]);
  });

  it("includes response annotations in the memory transcript", async () => {
    const {
      module: { MemoryAgent },
      mocks,
    } = await loadMemoryAgentRuntime();
    const messages = createMessages("annotated");
    messages[2] = {
      id: "annotated-user",
      role: "user",
      text: "请基于以下评论批注内容给出反馈。",
      timestamp: 4,
      responseAnnotations: [
        {
          id: "annotation-1",
          sourceMessageId: "assistant-source",
          anchor: {
            startOffset: 0,
            endOffset: 4,
            selectedText: "原文内容",
          },
          comment: "需要整体调整",
        },
      ],
    };
    mocks.loadMessages.mockResolvedValue(messages);
    const agent = new MemoryAgent();

    await agent.onConversationEnd("annotated-session", "workspace-a");
    await agent.processNow();

    const prompt = mocks.buildMemoryProfile.mock.calls[0][0].harness.prompt.user;
    expect(prompt).toContain("<response_annotations>");
    expect(prompt).toContain("原文内容");
    expect(prompt).toContain("需要整体调整");
  });
});
