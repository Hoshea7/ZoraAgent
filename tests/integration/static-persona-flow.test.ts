import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ZORA_STATIC_SYSTEM_PROMPT } from "@/main/prompts/zora-static-system-prompt";

const hitlModuleId = path.resolve(process.cwd(), "src/main/hitl.ts");
const mcpManagerModuleId = path.resolve(process.cwd(), "src/main/mcp-manager.ts");
const tempHomes = new Set<string>();

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-static-persona-int-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function createProfileContext(overrides: Partial<import("@/main/query-profiles").ProfileBuildContext> = {}) {
  return {
    userPrompt: "你是谁？我怎么称呼你比较好？",
    cwd: process.cwd(),
    sdkRuntime: {
      executable: "node" as const,
      executableArgs: [],
      pathToClaudeCodeExecutable: "/tmp/fake-sdk-cli",
      env: {},
    },
    onEvent: vi.fn(),
    isFirstTurn: true,
    toolProvisioningPlan: { tools: [] },
    toolProvisioningRequest: {
      sessionId: "session-1",
      workspaceId: "default",
      runtime: "claude" as const,
      source: "desktop" as const,
    },
    toolPolicy: { mode: "default" as const },
    ...overrides,
  };
}

async function loadStaticPersonaRuntime(homeDir: string) {
  vi.resetModules();

  const buildSdkMcpServers = vi.fn(async () => ({
    zora_builtin: { type: "stdio" as const, command: "node", args: ["mcp.js"] },
  }));
  const createCanUseTool = vi.fn(() => vi.fn(async () => ({ behavior: "allow" })));

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  vi.doMock(hitlModuleId, () => ({
    createCanUseTool,
    authorizeProductTool: vi.fn(async () => ({ behavior: "allow" })),
    clearAllPending: vi.fn(),
  }));

  vi.doMock(mcpManagerModuleId, () => ({
    createClaudeToolsFromProvisioningPlan: vi.fn(() => ({
      servers: {},
      toolNames: [],
    })),
    getSharedMcpManager: () => ({
      buildSdkMcpServers,
    }),
  }));

  return {
    memoryStoreModule: await import("@/main/memory-store"),
    queryProfilesModule: await import("@/main/query-profiles"),
    mocks: {
      buildSdkMcpServers,
      createCanUseTool,
    },
  };
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.doUnmock(hitlModuleId);
  vi.doUnmock(mcpManagerModuleId);
  vi.resetModules();

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("integration static persona flow", () => {
  it("builds the productivity profile with the static Zora persona and normal agent loop options", async () => {
    const homeDir = createTempHome();
    const {
      queryProfilesModule,
      mocks,
    } = await loadStaticPersonaRuntime(homeDir);

    const profile = await queryProfilesModule.buildProductivityProfile(
      createProfileContext({
        cwd: "/tmp/zora-workspace",
        localSessionId: "session-1",
      })
    );

    expect(profile.name).toBe("productivity");
    expect(profile.prompt).toBe("你是谁？我怎么称呼你比较好？");
    expect(profile.options.cwd).toBe("/tmp/zora-workspace");
    expect(profile.options.permissionMode).toBe("default");
    expect(profile.options.plugins).toEqual([
      expect.objectContaining({ type: "local" }),
    ]);
    expect(profile.options.mcpServers).toEqual({
      zora_builtin: { type: "stdio", command: "node", args: ["mcp.js"] },
    });
    expect(profile.options.strictMcpConfig).toBe(true);
    expect(profile.options.canUseTool).toBeTypeOf("function");
    expect(profile.options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: ZORA_STATIC_SYSTEM_PROMPT,
    });
    expect(mocks.buildSdkMcpServers).toHaveBeenCalledTimes(1);
  });

  it("keeps dynamic memory out of systemPrompt.append", async () => {
    const homeDir = createTempHome();
    const {
      memoryStoreModule,
      queryProfilesModule,
    } = await loadStaticPersonaRuntime(homeDir);

    await memoryStoreModule.saveFile("USER.md", "Old user prompt.");
    await memoryStoreModule.saveFile("MEMORY.md", "Old memory prompt.");

    const profile = await queryProfilesModule.buildProductivityProfile(
      createProfileContext()
    );

    expect(profile.options.systemPrompt.append).toBe(ZORA_STATIC_SYSTEM_PROMPT);
    expect(profile.options.systemPrompt.append).not.toContain("Old user prompt.");
    expect(profile.options.systemPrompt.append).not.toContain("Old memory prompt.");
  });
});
