import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test as base } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { AgentRuntimeType } from "../../../src/shared/zora";
import type { ProviderConfig } from "../../../src/shared/types/provider";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const RUNS_ROOT = path.join(REPO_ROOT, "tests", ".artifacts", "e2e", "runs");
const REAL_HOME = process.env.HOME ?? "";

/** 所有 E2E 都跑真实 Provider，不存在 mock 引擎。 */
export const RUNTIMES: readonly AgentRuntimeType[] = ["claude", "pi"] as const;

interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
  /** 每个用例独立的可写目录。会话 cwd 默认是仓库根，让模型写这里避免污染仓库。 */
  scratchDir: string;
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

/**
 * 读取本机已启用的 Provider。E2E 依赖真实模型，因此缺少配置时直接失败，
 * 而不是退回任何形式的模拟引擎。
 */
export async function loadRealProviders(): Promise<ProviderConfig[]> {
  const sourcePath = path.join(REAL_HOME, ".zora", "providers.json");
  const providers = JSON.parse(await readFile(sourcePath, "utf8")) as ProviderConfig[];
  const requestedProviderId = process.env.ZORA_E2E_PROVIDER_ID?.trim();
  const enabled = providers.filter((provider) => provider.enabled);
  const selected = requestedProviderId
    ? enabled.find((provider) => provider.id === requestedProviderId)
    : enabled.find((provider) => provider.isDefault) ?? enabled[0];

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

  return enabled.map((provider) => ({
    ...provider,
    isDefault: provider.id === selected.id,
  }));
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
    "utf8"
  );
}

export const test = base.extend<ElectronFixtures>({
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

  electronApp: async ({}, use, testInfo) => {
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
    let app: ElectronApplication | null = null;

    try {
      const realProviders = await loadRealProviders();
      const realProvider =
        realProviders.find((provider) => provider.isDefault) ?? realProviders[0];
      if (!realProvider) {
        throw new Error("E2E Provider 配置为空。");
      }
      const configuredModelIds = [
        realProvider.modelId,
        ...Object.values(realProvider.roleModels ?? {}),
      ].filter((modelId): modelId is string => Boolean(modelId?.trim()));
      await Promise.all([
        writeFile(
          path.join(zoraHome, "providers.json"),
          `${JSON.stringify(realProviders, null, 2)}\n`,
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
        writeFile(path.join(zoraHome, "mcp.json"), '{"servers":{}}\n', "utf8"),
        writeFile(
          path.join(zoraHome, "vision-settings.json"),
          `${JSON.stringify({
            relay: { enabled: false },
            capabilityOverrides: configuredModelIds.map((modelId) => ({
              providerId: realProvider.id,
              modelId,
              capability: "supported",
            })),
          }, null, 2)}\n`,
          "utf8"
        ),
        seedProbeSkill(zoraHome),
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
      if (app) {
        const process = app.process();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          void app.close().catch(() => undefined).finally(() => {
            clearTimeout(timer);
            resolve();
          });
        });
        if (process.exitCode === null) process.kill("SIGKILL");
      }
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
          .screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true })
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
  runtime: AgentRuntimeType
): Promise<void> {
  const selector = page.getByRole("button", { name: "切换运行时" });
  await expect(selector).toBeVisible();
  const label = RUNTIME_LABELS[runtime];
  if ((await selector.textContent())?.includes(label)) return;

  await selector.click();
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await expect(selector).toContainText(label);
}

/** 走真实用户路径选择 Provider 已配置的模型。 */
export async function selectModel(page: Page, modelId: string): Promise<void> {
  const selector = page.getByRole("button", { name: "切换当前模型渠道" });
  await expect(selector).toBeVisible();
  if ((await selector.textContent())?.includes(modelId)) return;

  await selector.click();
  // 选中标记（✓/·）属于按钮的可访问名称，按文本匹配以兼容选中与未选中状态。
  await page.getByRole("button").filter({ hasText: modelId }).last().click();
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
  timeoutMs = 60_000
): Promise<Locator> {
  const assistantBodies = page.locator(".ai-message-content");
  const stopButton = page.locator('button[title="停止"]');
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let observedRunning = false;

  while (Date.now() < deadline) {
    const texts = await assistantBodies.allTextContents();
    const newTexts = texts.slice(previousAssistantCount);
    const matchIndex = newTexts.findIndex((text) => text.includes(expectedText));
    if (matchIndex >= 0) {
      return assistantBodies.nth(previousAssistantCount + matchIndex);
    }

    const running = await stopButton.isVisible().catch(() => false);
    observedRunning ||= running;
    const hasCompletedTurn = newTexts.length > 0 && !running;
    if (hasCompletedTurn && (observedRunning || Date.now() - startedAt >= 1_000)) {
      const actualText = newTexts.at(-1) ?? "";
      const actualPreview =
        actualText.length > 1_000 ? `${actualText.slice(0, 1_000)}…` : actualText;
      throw new Error(
        `Agent 已结束，但最终回复不包含 ${expectedText}。实际回复：${actualPreview}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`等待 Assistant 回复 ${expectedText} 超过 ${timeoutMs}ms。`);
}

/** 仓库内 package.json 的绝对路径，用于让真实模型执行确定性的读文件。 */
export const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");

export { expect };
