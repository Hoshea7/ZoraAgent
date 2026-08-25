import { access } from "node:fs/promises";
import path from "node:path";
import {
  E2E_COVERAGE,
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";
import type { ElectronApplication, Page } from "@playwright/test";

const TOOL_WORKSPACE_ID = "tool-authorization-project";
const TOOL_SESSION_ID = "tool-authorization-session";
const TOOL_SESSION_TITLE = "工具授权检查";
const TOOL_WORKSPACE_TIME = "2026-08-25T00:00:00.000Z";

test.use({
  workspaceSeed: {
    id: TOOL_WORKSPACE_ID,
    name: "工具授权项目",
    createdAt: TOOL_WORKSPACE_TIME,
    updatedAt: TOOL_WORKSPACE_TIME,
    sessions: [
      {
        id: TOOL_SESSION_ID,
        title: TOOL_SESSION_TITLE,
        createdAt: TOOL_WORKSPACE_TIME,
        updatedAt: TOOL_WORKSPACE_TIME,
        permissionMode: "ask",
      },
    ],
  },
});

/**
 * 切片 1：工具授权（ToolGate）。
 *
 * 验证视角是「一个在意安全的用户会怎么确认审批真的管用」：
 *   1. 危险操作必须先问我，我批准了才发生
 *   2. 我拒绝了就真的不能发生（不只是 UI 上消失）
 *   3. 换引擎不改变这个保证
 *   4. 只读操作不要反复打扰我
 *   5. 我主动关掉审批（YOLO）时要真的不再拦
 *
 * 断言锚点是**磁盘真实状态**而非模型措辞：模型可能声称写了却没写，也可能被拒后
 * 仍谎称成功，只有文件系统是事实。
 */

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function openToolWorkspace(page: Page): Promise<void> {
  const project = page.getByRole("button", {
    name: "工具授权项目",
    exact: true,
  });
  if ((await project.getAttribute("aria-expanded")) !== "true") {
    await project.click();
  }
  await page.locator(`[data-session-id="${TOOL_SESSION_ID}"]`).click();
  await expect(
    page.getByRole("heading", { name: TOOL_SESSION_TITLE, exact: true }),
  ).toBeVisible();
}

async function toolWorkspaceTarget(
  electronApp: ElectronApplication,
  fileName: string,
): Promise<string> {
  const zoraHome = await electronApp.evaluate(() => process.env.ZORA_HOME);
  if (!zoraHome) throw new Error("E2E 缺少 ZORA_HOME。");
  return path.join(zoraHome, "e2e-workspaces", TOOL_WORKSPACE_ID, fileName);
}

/** 等待真实文件结果；Agent 已结束但文件仍不存在时立即失败。 */
async function waitForFileWhileAgentRuns(
  page: import("@playwright/test").Page,
  target: string,
  previousAssistantTurnCount: number,
  timeoutMs = 60_000,
): Promise<void> {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let observedRunning = false;
  while (Date.now() < deadline) {
    if (await fileExists(target)) return;

    const running = await stopButton(page).isVisible().catch(() => false);
    observedRunning ||= running;
    const replies = (
      await page.locator("[data-assistant-message='true']").allTextContents()
    ).slice(previousAssistantTurnCount);
    if (
      replies.length > 0 &&
      !running &&
      (observedRunning || Date.now() - startedAt >= 1_000)
    ) {
      throw new Error(
        `Agent 已结束，但文件 ${target} 未创建。最终回复：${replies.at(-1) ?? ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待文件 ${target} 超过 ${timeoutMs}ms。`);
}

const approvalCard = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: /需要 \w+ 执行权限/ });

const stopButton = (page: import("@playwright/test").Page) =>
  page.locator('button[title="停止"]');

async function advanceToToolApproval(
  page: import("@playwright/test").Page,
  toolName: string,
): Promise<void> {
  const banner = page.getByTestId("permission-banner");
  const deadline = Date.now() + 60_000;
  let observedRunning = false;
  while (!(await banner.isVisible().catch(() => false))) {
    const running = await stopButton(page).isVisible().catch(() => false);
    observedRunning ||= running;
    if (observedRunning && !running) {
      throw new Error(`Agent 已结束，但没有出现 ${toolName} 审批。`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`等待 ${toolName} 审批超过 60000ms。`);
    }
    await page.waitForTimeout(200);
  }

  const requestText = await banner.textContent();
  if (!(await approvalCard(page).textContent())?.includes(toolName)) {
    throw new Error(
      `期望 ${toolName} 审批，但 Agent 请求了其他工具：${requestText ?? "未知工具"}`,
    );
  }
}

async function denyPendingToolRequests(
  page: import("@playwright/test").Page
): Promise<void> {
  const reason = "拒绝此操作。不要尝试其他工具，直接结束当前任务。";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wasRunning = await stopButton(page).isVisible().catch(() => false);
    await page.getByRole("button", { name: /提供拒绝理由/ }).click();
    await page.getByPlaceholder(/告诉 Zora 你希望怎么调整/).fill(reason);
    await page.getByRole("button", { name: "发送理由", exact: true }).click();
    await expect(approvalCard(page)).toBeHidden({ timeout: 5_000 });

    const deadline = Date.now() + 30_000;
    let settledSince: number | undefined;
    let next: "settled" | "permission" | undefined;
    while (Date.now() < deadline) {
      if (await approvalCard(page).isVisible().catch(() => false)) {
        next = "permission";
        break;
      }
      const running = await stopButton(page).isVisible().catch(() => false);
      if (running) {
        settledSince = undefined;
      } else if (wasRunning) {
        settledSince ??= Date.now();
        if (Date.now() - settledSince >= 500) {
          next = "settled";
          break;
        }
      }
      await page.waitForTimeout(100);
    }
    if (!next) {
      throw new Error("拒绝权限后，Agent 在 30000ms 内既未结束也未提出新的权限请求。");
    }
    if (next === "settled") return;
  }

  throw new Error("Agent 在连续三次明确拒绝后仍继续申请替代工具权限。");
}

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 工具授权`, E2E_COVERAGE.productAgentProvider, () => {
    test("写文件前必须审批，点允许后文件真的落盘", async ({
      electronApp,
      page,
    }) => {
      test.setTimeout(120_000);

      const target = await toolWorkspaceTarget(electronApp, "approved.txt");
      expect(await fileExists(target)).toBe(false);

      await openToolWorkspace(page);
      await selectRuntime(page, runtime);
      const previousAssistantCount = await page
        .locator("[data-assistant-message='true']")
        .count();
      await sendMessage(
        page,
        `请使用 Write 工具创建文件 ${target}，内容就写 APPROVED。只做这一件事。`
      );

      // 未经我同意，不允许发生写操作。
      await advanceToToolApproval(page, "Write");
      expect(await fileExists(target)).toBe(false);

      await page.getByRole("button", { name: "允许", exact: true }).click();

      await waitForFileWhileAgentRuns(page, target, previousAssistantCount);
    });

    test("点拒绝后文件不会被创建，且运行正常收敛", async ({
      electronApp,
      page,
    }) => {
      test.setTimeout(120_000);

      const target = await toolWorkspaceTarget(electronApp, "denied.txt");

      await openToolWorkspace(page);
      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        `必须立即使用 Write 工具创建文件 ${target}，内容就写 DENIED。只做这一件事。`
      );

      await advanceToToolApproval(page, "Write");
      await denyPendingToolRequests(page);

      // 拒绝不能只是关掉卡片：工具必须真的没执行，且运行要正常结束而非挂死。
      await expect(stopButton(page)).not.toBeVisible({ timeout: 5_000 });
      expect(await fileExists(target)).toBe(false);
    });

    test("只读操作不打扰用户，不弹审批", async ({ page }) => {
      test.setTimeout(120_000);

      await openToolWorkspace(page);
      await selectRuntime(page, runtime);
      const previousAssistantCount = await page
        .locator("[data-assistant-message='true']")
        .count();
      await sendMessage(
        page,
        `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，只回答其中的 name 字段值。`
      );

      await expectAssistantTextUntilSettled(
        page,
        "zora",
        previousAssistantCount,
        60_000
      );

      // 只读工具属于安全白名单，全程不应出现审批卡。
      await expect(approvalCard(page)).toHaveCount(0);
    });

    test("切到 YOLO 模式后写文件不再拦截", async ({ electronApp, page }) => {
      test.setTimeout(120_000);

      const target = await toolWorkspaceTarget(electronApp, "yolo.txt");

      await openToolWorkspace(page);
      await selectRuntime(page, runtime);

      // 权限模式按钮是循环切换：Ask → Smart → YOLO。
      const modeButton = page.getByRole("button", { name: /^当前权限模式：/ });
      await expect(modeButton).toBeVisible();
      while (!(await modeButton.getAttribute("aria-label"))?.includes("YOLO")) {
        await modeButton.click();
        await expect(modeButton).toBeEnabled();
      }

      const previousAssistantCount = await page
        .locator("[data-assistant-message='true']")
        .count();
      await sendMessage(
        page,
        `请使用 Write 工具创建文件 ${target}，内容就写 YOLO。只做这一件事。`
      );

      // YOLO 下不应出现审批卡，文件应直接落盘。
      await waitForFileWhileAgentRuns(page, target, previousAssistantCount);
      await expect(approvalCard(page)).toHaveCount(0);
    });
  });
}
