import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const hitlModuleId = path.resolve(process.cwd(), "src/main/hitl.ts");
const mcpManagerModuleId = path.resolve(process.cwd(), "src/main/mcp-manager.ts");
const promptBuilderModuleId = path.resolve(process.cwd(), "src/main/prompt-builder.ts");
const sdkEnvModuleId = path.resolve(process.cwd(), "src/main/query-profiles/sdk-env.ts");
const skillManagerModuleId = path.resolve(process.cwd(), "src/main/skill-manager.ts");
const tempHomes = new Set<string>();

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-query-profiles-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function createSdkRuntime(env: Record<string, string> = {}) {
  return {
    executable: "node" as const,
    executableArgs: [],
    pathToClaudeCodeExecutable: "/tmp/fake-sdk-cli",
    env,
  };
}

async function loadProfileModules(homeDir = createTempHome()) {
  vi.resetModules();

  const buildSdkMcpServers = vi.fn(async () => ({}));
  const createCanUseTool = vi.fn(() => vi.fn(async () => ({ behavior: "allow" })));
  const resolveSdkEnvForProfile = vi.fn(async () => ({
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
    ZORA_TEST_ENV: "from-profile-env",
  }));

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  vi.doMock(hitlModuleId, () => ({
    createCanUseTool,
  }));

  vi.doMock(mcpManagerModuleId, () => ({
    getSharedMcpManager: () => ({
      buildSdkMcpServers,
    }),
  }));

  vi.doMock(promptBuilderModuleId, () => ({
    buildZoraSystemPrompt: vi.fn(async () => ({
      type: "preset",
      preset: "claude_code",
      append: "Zora static prompt",
    })),
  }));

  vi.doMock(sdkEnvModuleId, () => ({
    resolveSdkEnvForProfile,
  }));

  vi.doMock(skillManagerModuleId, () => ({
    getZoraPluginPath: () => "/tmp/zora-plugin",
  }));

  return {
    homeDir,
    productivityModule: await import("@/main/query-profiles/productivity"),
    memoryModule: await import("@/main/query-profiles/memory"),
    mocks: {
      buildSdkMcpServers,
      createCanUseTool,
      resolveSdkEnvForProfile,
    },
  };
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.doUnmock(hitlModuleId);
  vi.doUnmock(mcpManagerModuleId);
  vi.doUnmock(promptBuilderModuleId);
  vi.doUnmock(sdkEnvModuleId);
  vi.doUnmock(skillManagerModuleId);
  vi.resetModules();

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("query profiles", () => {
  it("forces Claude Code auto-memory off for productivity runs", async () => {
    const { productivityModule } = await loadProfileModules();

    const profile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello",
      cwd: "/tmp/workspace",
      sdkRuntime: createSdkRuntime({
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
        ZORA_RUNTIME_ENV: "from-runtime",
      }),
      onEvent: vi.fn(),
      isFirstTurn: true,
    });

    expect(profile.options.env.ZORA_TEST_ENV).toBe("from-profile-env");
    expect(profile.options.env.ZORA_RUNTIME_ENV).toBe("from-runtime");
    expect(profile.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(profile.options.maxTurns).toBe(120);
  });

  it("forces Claude Code auto-memory off for memory agent runs", async () => {
    const { homeDir, memoryModule } = await loadProfileModules();

    const profile = await memoryModule.buildMemoryProfile({
      prompt: "summarize this session",
      sdkRuntime: createSdkRuntime({
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
      }),
    });

    expect(profile.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(profile.options.cwd).toBe(path.join(homeDir, ".zora", "memory"));
  });

  it("translates reasoningEffort to thinking budget env var", async () => {
    const { productivityModule } = await loadProfileModules();

    const lowProfile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello",
      cwd: "/tmp/workspace",
      sdkRuntime: createSdkRuntime(),
      onEvent: vi.fn(),
      isFirstTurn: true,
      reasoningEffort: "low",
    });
    expect(lowProfile.options.env.MAX_THINKING_TOKENS).toBe("4096");
    expect(lowProfile.options.thinkingBudget).toBe(4096);

    const highProfile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello",
      cwd: "/tmp/workspace",
      sdkRuntime: createSdkRuntime(),
      onEvent: vi.fn(),
      isFirstTurn: true,
      reasoningEffort: "high",
    });
    expect(highProfile.options.env.MAX_THINKING_TOKENS).toBe("32768");
    expect(highProfile.options.thinkingBudget).toBe(32768);
  });

  it("disables thinking when reasoningEffort is none", async () => {
    const { productivityModule } = await loadProfileModules();

    const profile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello",
      cwd: "/tmp/workspace",
      sdkRuntime: createSdkRuntime(),
      onEvent: vi.fn(),
      isFirstTurn: true,
      reasoningEffort: "none",
    });
    expect(profile.options.env.MAX_THINKING_TOKENS).toBeUndefined();
    expect(profile.options.thinkingBudget).toBeUndefined();
  });

  it("passes maxOutputTokens to profile options", async () => {
    const { productivityModule } = await loadProfileModules();

    const profile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello",
      cwd: "/tmp/workspace",
      sdkRuntime: createSdkRuntime(),
      onEvent: vi.fn(),
      isFirstTurn: true,
      maxOutputTokens: 8192,
    });
    expect(profile.options.maxOutputTokens).toBe(8192);
  });
});
