import { existsSync } from "node:fs";
import path from "node:path";

const sdkState = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((input: { options: Record<string, unknown> }) => {
    sdkState.options = input.options;
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "OK",
        };
      },
      close: vi.fn(),
    };
  }),
}));

vi.mock("@/main/provider-manager", () => ({
  buildProviderSdkEnv: vi.fn(() => ({ ANTHROPIC_API_KEY: "test-key" })),
}));

vi.mock("@/main/sdk-runtime", () => ({
  getPackagedSafeWorkingDirectory: vi.fn(() => process.cwd()),
  getSDKRuntimeOptions: vi.fn(() => ({
    pathToClaudeCodeExecutable: "/tmp/claude-cli.js",
    executable: "node",
    executableArgs: [],
    env: {},
  })),
}));

describe("Live SDK filesystem isolation", () => {
  it("runs every default query inside a disposable sandbox", async () => {
    const { sendLiveQuery } = await import("../../live/helpers/sdk-harness");
    const result = await sendLiveQuery(
      {
        apiKey: "test-key",
        baseUrl: "https://provider.test",
        model: "test-model",
        name: "Test Provider",
        providerType: "custom",
        protocol: "anthropic-messages",
      },
      "Reply with OK",
    );

    expect(result.success).toBe(true);
    const options = sdkState.options as {
      cwd: string;
      env: Record<string, string>;
    };
    const repoRoot = path.resolve(__dirname, "../../..");
    const relativeCwd = path.relative(repoRoot, options.cwd);

    expect(relativeCwd).toMatch(/^tests\/\.artifacts\/live\/sandboxes\//);
    expect(options.cwd).not.toBe(repoRoot);
    expect(options.env.HOME).toContain("tests/.artifacts/live/sandboxes/");
    expect(options.env.USERPROFILE).toBe(options.env.HOME);
    expect(options.env.ZORA_HOME).toBe(path.join(options.env.HOME, ".zora"));
    expect(options.env.TMPDIR).toContain("tests/.artifacts/live/sandboxes/");
    expect(existsSync(options.cwd)).toBe(false);
  });
});
