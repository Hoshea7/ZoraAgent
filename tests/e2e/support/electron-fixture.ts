import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test as base } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  startOpenAiTestServer,
  type OpenAiTestServer,
} from "./openai-test-server";
import type { ProviderConfig } from "../../../src/shared/types/provider";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const RUNS_ROOT = path.join(REPO_ROOT, "tests", ".artifacts", "e2e", "runs");
const REAL_HOME = process.env.HOME ?? "";

interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
}

interface ElectronOptions {
  mockDefaultProtocol: "openai" | "anthropic";
}

function electronEnvironment(zoraHome: string, home: string): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );

  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_FORCE_IS_PACKAGED;
  delete environment.VITE_DEV_SERVER_URL;

  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    ZORA_HOME: zoraHome,
    ZORA_E2E: "1",
  };
}

async function loadLiveProvider(): Promise<ProviderConfig> {
  const sourcePath = path.join(REAL_HOME, ".zora", "providers.json");
  const providers = JSON.parse(await readFile(sourcePath, "utf8")) as ProviderConfig[];
  const requestedProviderId = process.env.ZORA_E2E_PROVIDER_ID?.trim();
  const selected = requestedProviderId
    ? providers.find((provider) => provider.id === requestedProviderId && provider.enabled)
    : providers.find((provider) => provider.enabled && provider.isDefault) ??
      providers.find((provider) => provider.enabled);

  if (!selected) {
    throw new Error(
      requestedProviderId
        ? `ZORA_E2E_PROVIDER_ID ${requestedProviderId} 不存在或未启用。`
        : "本机 ~/.zora/providers.json 中没有已启用的 Provider。"
    );
  }

  if (!selected.apiKey || !selected.modelId) {
    throw new Error(`Provider ${selected.name} 缺少 apiKey 或 modelId。`);
  }

  return { ...selected, isDefault: true };
}

export const test = base.extend<ElectronFixtures & ElectronOptions>({
  mockDefaultProtocol: ["openai", { option: true }],

  electronApp: async ({ mockDefaultProtocol }, use, testInfo) => {
    const useLiveProvider = process.env.ZORA_E2E_LIVE === "1";
    await mkdir(RUNS_ROOT, { recursive: true });
    const runDirectory = await mkdtemp(
      path.join(RUNS_ROOT, `${Date.now()}-${testInfo.workerIndex}-`)
    );
    const home = path.join(runDirectory, "home");
    const zoraHome = path.join(home, ".zora");
    const logDirectory = path.join(runDirectory, "logs");
    await Promise.all([
      mkdir(zoraHome, { recursive: true }),
      mkdir(logDirectory, { recursive: true }),
    ]);

    const mainLogs: string[] = [];
    let providerServer: OpenAiTestServer | null = null;
    let app: ElectronApplication | null = null;

    try {
      providerServer = useLiveProvider
        ? null
        : await startOpenAiTestServer(path.join(REPO_ROOT, "package.json"));
      const now = Date.now();
      const providers = useLiveProvider
        ? [await loadLiveProvider()]
        : [{
            id: "e2e-openai-provider",
            name: "E2E OpenAI",
            providerType: "custom" as const,
            protocol: "openai-completions" as const,
            baseUrl: providerServer!.baseUrl,
            apiKey: "e2e-api-key",
            modelId: "zora-e2e-model",
            enabled: true,
            isDefault: mockDefaultProtocol === "openai",
            createdAt: now,
            updatedAt: now,
          }, {
            id: "e2e-anthropic-provider",
            name: "E2E Anthropic",
            providerType: "custom" as const,
            protocol: "anthropic-messages" as const,
            baseUrl: providerServer!.baseUrl,
            apiKey: "e2e-api-key",
            modelId: "zora-e2e-anthropic",
            enabled: true,
            isDefault: mockDefaultProtocol === "anthropic",
            createdAt: now,
            updatedAt: now,
          }];
      await Promise.all([
        writeFile(
          path.join(zoraHome, "providers.json"),
          `${JSON.stringify(providers, null, 2)}\n`,
          "utf8"
        ),
        writeFile(
          path.join(zoraHome, "memory-settings.json"),
          `${JSON.stringify({
            enabled: false,
            mode: "manual",
            batchIdleMinutes: 30,
            memoryProviderId: null,
            memoryModelId: null,
          })}\n`,
          "utf8"
        ),
        writeFile(path.join(zoraHome, "mcp.json"), "{\"servers\":{}}\n", "utf8"),
      ]);

      app = await electron.launch({
        args: [REPO_ROOT],
        cwd: REPO_ROOT,
        env: electronEnvironment(zoraHome, home),
      });
      app.process().stdout?.on("data", (chunk) => mainLogs.push(String(chunk)));
      app.process().stderr?.on("data", (chunk) => mainLogs.push(String(chunk)));

      await use(app);
    } finally {
      await writeFile(
        path.join(logDirectory, "electron.log"),
        mainLogs.join(""),
        "utf8"
      ).catch(() => undefined);
      await app?.close().catch(() => undefined);
      await providerServer?.close().catch(() => undefined);
      if (useLiveProvider || testInfo.status === testInfo.expectedStatus) {
        await rm(home, { recursive: true, force: true });
      }
    }
  },

  page: async ({ electronApp }, use, testInfo) => {
    const page = await electronApp.firstWindow();
    const rendererLogs: string[] = [];
    page.on("console", (message) => {
      rendererLogs.push(`[${message.type()}] ${message.text()}\n`);
    });
    page.on("pageerror", (error) => {
      rendererLogs.push(`[pageerror] ${error.stack ?? error.message}\n`);
    });

    await page.waitForLoadState("domcontentloaded");

    try {
      await use(page);
    } finally {
      await testInfo.attach("renderer.log", {
        body: Buffer.from(rendererLogs.join(""), "utf8"),
        contentType: "text/plain",
      });
      if (testInfo.status !== testInfo.expectedStatus) {
        await page.screenshot({
          path: testInfo.outputPath("failure.png"),
          fullPage: true,
        }).catch(() => undefined);
      }
    }
  },
});

export { expect };
