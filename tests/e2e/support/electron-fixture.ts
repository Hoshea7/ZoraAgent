import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test as base } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { AgentRuntimeType, SessionMeta } from "../../../src/shared/zora";
import type {
  ProviderConfig,
  ProviderModel,
  ProviderPresetId,
} from "../../../src/shared/types/provider";
import { resolveProviderProtocol } from "../../../src/shared/provider-protocol";
import { assertE2EWritePath } from "./e2e-path-safety";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const RUNS_ROOT = path.join(REPO_ROOT, "tests", ".artifacts", "e2e", "runs");
const REAL_HOME = process.env.HOME ?? "";

/** 所有 E2E 都跑真实 Provider，不存在 mock 引擎。 */
export const RUNTIMES: readonly AgentRuntimeType[] = ["claude", "pi"] as const;

interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
  /** 每个用例独立的可写目录，用于显式验证文件读写。 */
  scratchDir: string;
  providerContextWindow?: number;
  providerModels?: { models: ProviderModel[] };
  providerPresetId?: ProviderPresetId;
  workspaceSeed?: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    sessions: Array<Omit<SessionMeta, "workingDirectory">>;
    sessionMessages?: Record<
      string,
      Array<{
        id: string;
        role: "user" | "assistant";
        text: string;
        timestamp: number;
      }>
    >;
  };
}

function electronEnvironment(
  zoraHome: string,
  home: string,
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
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

/**
 * 读取本机已启用的 Provider。E2E 依赖真实模型，因此缺少配置时直接失败，
 * 而不是退回任何形式的模拟引擎。
 */
export async function loadRealProviders(
  requestedPresetId?: ProviderPresetId,
): Promise<ProviderConfig[]> {
  const sourcePath = path.join(REAL_HOME, ".zora", "providers.json");
  const parsed = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  const rawProviders = Array.isArray(parsed)
    ? parsed
    : (parsed as { providers?: unknown[] }).providers;
  if (!Array.isArray(rawProviders)) {
    throw new Error("本机 Provider 配置格式无效。");
  }
  const legacyDefaultProviderId = rawProviders.find(
    (raw) => typeof raw === "object" && raw !== null &&
      (raw as { isDefault?: unknown }).isDefault === true
  ) as { id?: unknown } | undefined;
  let configuredDefaultProviderId: string | undefined;
  try {
    const settings = JSON.parse(
      await readFile(path.join(REAL_HOME, ".zora", "default-model-settings.json"), "utf8")
    ) as { defaultProviderId?: unknown };
    if (typeof settings.defaultProviderId === "string") {
      configuredDefaultProviderId = settings.defaultProviderId;
    }
  } catch {
    // Legacy installations may not have an explicit default model file yet.
  }
  const providers = rawProviders.map((raw) => {
    const provider = raw as ProviderConfig & {
      modelId?: string;
      roleModels?: Record<string, string>;
      contextWindow?: number;
      isDefault?: boolean;
    };
    const {
      modelId: legacyModelId,
      roleModels: legacyRoleModels,
      contextWindow: legacyContextWindow,
      isDefault: _legacyIsDefault,
      ...providerFields
    } = provider;
    if (Array.isArray(provider.models)) return providerFields as ProviderConfig;
    const ids = Array.from(
      new Set(
        [legacyModelId, ...Object.values(legacyRoleModels ?? {})].filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
      ),
    );
    return {
      ...providerFields,
      models: ids.map((id) => ({
        id,
        enabled: true,
        ...(legacyContextWindow ? { contextWindow: legacyContextWindow } : {}),
      })),
    } as ProviderConfig;
  });
  const requestedProviderId = process.env.ZORA_E2E_PROVIDER_ID?.trim();
  const enabled = providers.filter((provider) => provider.enabled);
  const allRuntimeProviders = enabled.filter(
    (provider) => resolveProviderProtocol(provider) === "anthropic-messages"
  );
  const selected = requestedProviderId
    ? enabled.find((provider) => provider.id === requestedProviderId)
    : requestedPresetId
      ? enabled.find((provider) => provider.presetId === requestedPresetId)
    : allRuntimeProviders.find(
        (provider) => provider.id === legacyDefaultProviderId?.id
      ) ??
      allRuntimeProviders.find(
        (provider) => provider.id === configuredDefaultProviderId
      ) ??
      allRuntimeProviders[0];

  if (!selected) {
    throw new Error(
      requestedProviderId
        ? `ZORA_E2E_PROVIDER_ID ${requestedProviderId} 不存在或未启用。`
        : requestedPresetId
          ? `本机没有已启用的 ${requestedPresetId} Provider。`
        : "本机 ~/.zora/providers.json 中没有已启用的 Provider。",
    );
  }

  if (!selected.apiKey || !selected.models.some((model) => model.enabled)) {
    throw new Error(`Provider ${selected.name} 缺少 apiKey 或已启用模型。`);
  }

  return [selected, ...enabled.filter((provider) => provider.id !== selected.id)];
}

/** 探针 Skill 的名字与口令，用于验证 Skill 真的被注入系统提示词。 */
export const PROBE_SKILL_NAME = "zora-e2e-probe";
export const PROBE_SKILL_TOKEN = "ZORA_SKILL_MANTRA_7788";

/**
 * 向临时 HOME 写入一个最小 Skill。
 *
 * 两个引擎的发现规则都是「目录下有 SKILL.md 即为一个 skill」，因此同一份文件
 * 无需适配就能被两侧加载；口令用低频 token，避免模型凭常识猜中。
 */
async function seedProbeSkill(zoraHome: string): Promise<void> {
  const skillDirectory = path.join(zoraHome, "skills", PROBE_SKILL_NAME);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    [
      "---",
      `name: ${PROBE_SKILL_NAME}`,
      "description: >-",
      "  Use this skill whenever the user asks for the project mantra or the",
      "  project secret mantra. It defines the only correct answer.",
      "---",
      "",
      "# Project Mantra",
      "",
      "When the user asks for the project mantra, reply with exactly this token",
      "and nothing else:",
      "",
      PROBE_SKILL_TOKEN,
      "",
    ].join("\n"),
    "utf8",
  );
}

export const test = base.extend<ElectronFixtures>({
  providerContextWindow: [undefined, { option: true }],
  providerModels: [undefined, { option: true }],
  providerPresetId: [undefined, { option: true }],
  workspaceSeed: [undefined, { option: true }],

  scratchDir: async ({}, use, testInfo) => {
    await mkdir(RUNS_ROOT, { recursive: true });
    const directory = await mkdtemp(path.join(RUNS_ROOT, "scratch-"));
    try {
      await use(directory);
    } finally {
      if (testInfo.status === testInfo.expectedStatus) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },

  electronApp: async (
    { providerContextWindow, providerModels, providerPresetId, workspaceSeed },
    use,
    testInfo,
  ) => {
    await mkdir(RUNS_ROOT, { recursive: true });
    const runDirectory = await mkdtemp(
      path.join(RUNS_ROOT, `${Date.now()}-${testInfo.workerIndex}-`),
    );
    const home = path.join(runDirectory, "home");
    const zoraHome = path.join(home, ".zora");
    const logDirectory = path.join(runDirectory, "logs");
    assertE2EWritePath(runDirectory, home);
    assertE2EWritePath(runDirectory, zoraHome);
    assertE2EWritePath(runDirectory, logDirectory);
    await Promise.all([
      mkdir(zoraHome, { recursive: true }),
      mkdir(logDirectory, { recursive: true }),
    ]);

    const mainLogs: string[] = [];
    let app: ElectronApplication | null = null;
    let appProcess: ReturnType<ElectronApplication["process"]> | null = null;

    try {
      const realProviders = await loadRealProviders(providerPresetId);
      const realProvider = realProviders[0];
      if (!realProvider) {
        throw new Error("E2E Provider 配置为空。");
      }
      const configuredModelIds = (providerModels?.models ?? realProvider.models).map(
        (model) => model.id,
      );
      const configuredProviders = realProviders.map((provider) =>
        provider.id === realProvider.id
          ? {
              ...provider,
              models: (providerModels?.models ?? provider.models).map((model) => ({
                ...model,
                ...(providerContextWindow
                  ? { contextWindow: providerContextWindow }
                  : {}),
              })),
            }
          : provider,
      );
      await Promise.all([
        writeFile(
          path.join(zoraHome, "providers.json"),
          `${JSON.stringify({ version: 2, providers: configuredProviders }, null, 2)}\n`,
          "utf8",
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
          "utf8",
        ),
        writeFile(
          path.join(zoraHome, "default-model-settings.json"),
          `${JSON.stringify({
            defaultProviderId: realProvider.id,
            defaultModelId: configuredModelIds[0] ?? null,
          }, null, 2)}\n`,
          "utf8",
        ),
        writeFile(path.join(zoraHome, "mcp.json"), '{"servers":{}}\n', "utf8"),
        writeFile(
          path.join(zoraHome, "vision-settings.json"),
          `${JSON.stringify(
            {
              relay: { enabled: false },
              capabilityOverrides: configuredModelIds.map((modelId) => ({
                providerId: realProvider.id,
                modelId,
                capability: "supported",
              })),
            },
            null,
            2,
          )}\n`,
          "utf8",
        ),
        seedProbeSkill(zoraHome),
      ]);
      if (workspaceSeed) {
        const workingDirectory = path.join(
          zoraHome,
          "e2e-workspaces",
          workspaceSeed.id,
        );
        const sessionsDirectory = path.join(
          zoraHome,
          "workspaces",
          workspaceSeed.id,
          "sessions",
        );
        assertE2EWritePath(runDirectory, workingDirectory);
        assertE2EWritePath(runDirectory, sessionsDirectory);
        await Promise.all([
          mkdir(workingDirectory, { recursive: true }),
          mkdir(sessionsDirectory, { recursive: true }),
        ]);
        await Promise.all([
          writeFile(
            path.join(zoraHome, "workspaces.json"),
            `${JSON.stringify(
              [
                {
                  id: workspaceSeed.id,
                  name: workspaceSeed.name,
                  path: workingDirectory,
                  createdAt: workspaceSeed.createdAt,
                  updatedAt: workspaceSeed.updatedAt,
                },
              ],
              null,
              2,
            )}\n`,
            "utf8",
          ),
          writeFile(
            path.join(sessionsDirectory, "index.json"),
            `${JSON.stringify(
              workspaceSeed.sessions.map((session) => ({
                ...session,
                workingDirectory,
              })),
              null,
              2,
            )}\n`,
            "utf8",
          ),
          ...Object.entries(workspaceSeed.sessionMessages ?? {}).map(
            ([sessionId, messages]) =>
              writeFile(
                path.join(sessionsDirectory, `${sessionId}.jsonl`),
                `${messages
                  .map((message) => {
                    if (message.role === "user") {
                      return JSON.stringify({
                        kind: "user",
                        message,
                      });
                    }
                    return JSON.stringify({
                      kind: "assistant_turn",
                      turn: {
                        id: message.id,
                        processSteps: [],
                        bodySegments: [
                          { id: `${message.id}-body`, text: message.text },
                        ],
                        status: "done",
                        startedAt: message.timestamp,
                        completedAt: message.timestamp,
                      },
                    });
                  })
                  .join("\n")}\n`,
                "utf8",
              ),
          ),
        ]);
      }

      app = await electron.launch({
        args: [REPO_ROOT],
        cwd: runDirectory,
        env: electronEnvironment(zoraHome, home),
      });
      appProcess = app.process();
      appProcess.stdout?.on("data", (chunk) => mainLogs.push(String(chunk)));
      appProcess.stderr?.on("data", (chunk) => mainLogs.push(String(chunk)));

      await use(app);
    } finally {
      await writeFile(
        path.join(logDirectory, "electron.log"),
        mainLogs.join(""),
        "utf8",
      ).catch(() => undefined);
      if (app) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          void app
            .close()
            .catch(() => undefined)
            .finally(() => {
              clearTimeout(timer);
              resolve();
            });
        });
        if (appProcess?.exitCode === null) appProcess.kill("SIGKILL");
      }
      await rm(path.join(zoraHome, "providers.json"), { force: true }).catch(
        () => undefined,
      );
      if (testInfo.status === testInfo.expectedStatus) {
        await rm(runDirectory, { recursive: true, force: true });
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
        await page
          .screenshot({
            path: testInfo.outputPath("failure.png"),
            fullPage: true,
          })
          .catch(() => undefined);
      }
    }
  },
});

const RUNTIME_LABELS: Record<AgentRuntimeType, string> = {
  claude: "Claude",
  pi: "Pi",
};

/** 走真实用户路径切换 Runtime：点选择器 → 选目标引擎 → 确认标签已更新。 */
export async function selectRuntime(
  page: Page,
  runtime: AgentRuntimeType,
): Promise<void> {
  const selector = page.getByRole("button", {
    name: "切换运行时",
  });
  await expect(selector).toBeVisible();
  const label = RUNTIME_LABELS[runtime];
  if ((await selector.textContent())?.includes(label)) return;

  await selector.click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  await expect(selector).toContainText(label);
}

/** 走真实用户路径选择 Provider 已配置的模型。 */
export async function selectModel(page: Page, modelId: string): Promise<void> {
  const selector = page.getByRole("button", {
    name: "切换模型与推理强度",
  });
  await expect(selector).toBeVisible();
  if ((await selector.textContent())?.includes(modelId)) return;

  await selector.click();
  await page.getByLabel("选择模型").hover();
  await page.getByRole("menuitem").filter({ hasText: modelId }).last().click();
  await expect(selector).toContainText(modelId);
}

/** 发送一条用户消息。 */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill(text);
  await composer.press("Enter");
}

/**
 * 等待新 Assistant Turn 出现目标文本。运行已经结束时立即按最终正文判定，
 * 避免在确定失败后继续消耗完整断言超时。
 */
export async function expectAssistantTextUntilSettled(
  page: Page,
  expectedText: string,
  previousAssistantCount: number,
  timeoutMs = 60_000,
): Promise<Locator> {
  const assistantBodies = page.locator(".ai-message-content");
  const stopButton = page.locator('button[title="停止"]');
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let observedRunning = false;

  while (Date.now() < deadline) {
    const texts = await assistantBodies.allTextContents();
    const newTexts = texts.slice(previousAssistantCount);
    const matchIndex = newTexts.findIndex((text) =>
      text.includes(expectedText),
    );
    if (matchIndex >= 0) {
      return assistantBodies.nth(previousAssistantCount + matchIndex);
    }

    const running = await stopButton.isVisible().catch(() => false);
    observedRunning ||= running;
    const hasCompletedTurn = newTexts.length > 0 && !running;
    if (
      hasCompletedTurn &&
      (observedRunning || Date.now() - startedAt >= 1_000)
    ) {
      const actualText = newTexts.at(-1) ?? "";
      const actualPreview =
        actualText.length > 1_000
          ? `${actualText.slice(0, 1_000)}…`
          : actualText;
      throw new Error(
        `Agent 已结束，但最终回复不包含 ${expectedText}。实际回复：${actualPreview}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`等待 Assistant 回复 ${expectedText} 超过 ${timeoutMs}ms。`);
}

/**
 * 关闭并重新启动同一临时 HOME 下的 Electron App，用于验证跨进程会话恢复。
 * 调用方负责在断言结束后关闭返回的新 ElectronApplication。
 */
export async function restartElectronApplication(
  electronApp: ElectronApplication,
): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const environment = await electronApp.evaluate(() => ({
    home: process.env.HOME,
    zoraHome: process.env.ZORA_HOME,
  }));
  if (!environment.home || !environment.zoraHome) {
    throw new Error("Electron E2E 缺少 HOME 或 ZORA_HOME，无法重启 App。");
  }

  await electronApp.close();
  const restartedApp = await electron.launch({
    args: [REPO_ROOT],
    cwd: path.dirname(environment.home),
    env: electronEnvironment(environment.zoraHome, environment.home),
  });
  const restartedPage = await restartedApp.firstWindow();
  await restartedPage.waitForLoadState("domcontentloaded");
  return { electronApp: restartedApp, page: restartedPage };
}

/** 仓库内 package.json 的绝对路径，用于让真实模型执行确定性的读文件。 */
export const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");

export { expect };
