import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

const createUnsubscribe = () => vi.fn();

function createZoraMock() {
  return {
    getAppVersion: vi.fn().mockResolvedValue("0.0.0-test"),
    logClientEvent: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    updater: {
      getStatus: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onStatusChanged: vi.fn(() => createUnsubscribe()),
    },
    listProviders: vi.fn().mockResolvedValue([]),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn().mockResolvedValue(undefined),
    setDefaultProvider: vi.fn().mockResolvedValue(undefined),
    getProviderApiKey: vi.fn().mockResolvedValue(null),
    testProvider: vi.fn(),
    testProviderWithRoleModels: vi.fn(),
    cancelProviderTest: vi.fn().mockResolvedValue(false),
    testDefaultProvider: vi.fn(),
    hasConfiguredProvider: vi.fn().mockResolvedValue(false),
    feishu: {
      getConfig: vi.fn().mockResolvedValue(null),
      saveConfig: vi.fn(),
      testConnection: vi.fn(),
      startBridge: vi.fn(),
      stopBridge: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
      onStatusChanged: vi.fn(() => createUnsubscribe()),
      onAgentStateChanged: vi.fn(() => createUnsubscribe()),
    },
    memory: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      processNow: vi.fn(),
      getPendingCount: vi.fn().mockResolvedValue(0),
      onPendingChanged: vi.fn(() => createUnsubscribe()),
      getStatus: vi.fn(),
    },
    vision: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
    },
    defaultModel: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
    },
    mcp: {
      getConfig: vi.fn(),
      getEditableConfig: vi.fn(),
      save: vi.fn(),
      deleteServer: vi.fn(),
      toggleServer: vi.fn(),
      testServer: vi.fn(),
    },
    chat: vi.fn().mockResolvedValue(undefined),
    isAgentRunning: vi.fn().mockResolvedValue(false),
    getAgentRunInfo: vi.fn(),
    listSkills: vi.fn().mockResolvedValue([]),
    openSkillsDir: vi.fn().mockResolvedValue(undefined),
    openSkillDir: vi.fn().mockResolvedValue(undefined),
    discoverSkills: vi.fn(),
    importSkill: vi.fn(),
    importSkills: vi.fn(),
    uninstallSkill: vi.fn().mockResolvedValue(undefined),
    listExternalTools: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    loadMessages: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    forkSession: vi.fn(),
    archiveSession: vi.fn().mockResolvedValue(null),
    restoreSession: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    lockSessionModel: vi.fn(),
    switchSessionModel: vi.fn(),
    setSessionRuntime: vi.fn().mockResolvedValue(undefined),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    createWorkspace: vi.fn(),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    pickWorkspaceDirectory: vi.fn().mockResolvedValue(null),
    filetree: {
      list: vi.fn().mockResolvedValue([]),
      openInFinder: vi.fn().mockResolvedValue(undefined),
      watch: vi.fn().mockResolvedValue(undefined),
      unwatch: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn(() => createUnsubscribe()),
    },
    onStream: vi.fn(() => createUnsubscribe()),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    selectFiles: vi.fn().mockResolvedValue([]),
    readFileAsAttachment: vi.fn().mockResolvedValue(null),
    getPathForFile: vi.fn((file: File) => file.name),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    answerAskUserQuestion: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(window, "zora", {
    writable: true,
    configurable: true,
    value: createZoraMock(),
  });
});
