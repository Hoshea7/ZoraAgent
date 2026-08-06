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
    expect(profile.options.maxTurns).toBe(500);
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

  it("translates product reasoning levels to Claude native options", async () => {
    const { productivityModule } = await loadProfileModules();

    const lowProfile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello", cwd: "/tmp/workspace", sdkRuntime: createSdkRuntime(),
      onEvent: vi.fn(), isFirstTurn: true, reasoningLevel: "low",
    });
    expect(lowProfile.options.thinking).toEqual({ type: "adaptive" });
    expect(lowProfile.options.effort).toBe("low");
    expect(lowProfile.options.env.MAX_THINKING_TOKENS).toBeUndefined();

    const maxProfile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello", cwd: "/tmp/workspace", sdkRuntime: createSdkRuntime(),
      onEvent: vi.fn(), isFirstTurn: true, reasoningLevel: "max",
    });
    expect(maxProfile.options).toMatchObject({
      thinking: { type: "adaptive" }, effort: "high",
    });
  });

  it("uses Claude native disabled thinking for product off", async () => {
    const { productivityModule } = await loadProfileModules();
    const profile = await productivityModule.buildProductivityProfile({
      userPrompt: "hello", cwd: "/tmp/workspace", sdkRuntime: createSdkRuntime(),
      onEvent: vi.fn(), isFirstTurn: true, reasoningLevel: "off",
    });
    expect(profile.options.thinking).toEqual({ type: "disabled" });
    expect(profile.options.effort).toBeUndefined();
  });
});
