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

/**
 * 轮询等待文件出现。
 *
 * 不用「停止按钮消失」判定运行结束：运行启动前停止按钮本来就不可见，
 * 那样断言会在模型动作之前抢跑通过，产生假绿。
 */
async function waitForFile(target: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(target)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const approvalCard = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: /需要 \w+ 执行权限/ });

const stopButton = (page: import("@playwright/test").Page) =>
  page.locator('button[title="停止"]');

async function denyPendingToolRequests(
  page: import("@playwright/test").Page
): Promise<void> {
  const reason = "拒绝此操作。不要尝试其他工具，直接结束当前任务。";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: /提供拒绝理由/ }).click();
    await page.getByPlaceholder(/告诉 Zora 你希望怎么调整/).fill(reason);
    await page.getByRole("button", { name: "发送理由", exact: true }).click();
    await expect(approvalCard(page)).toBeHidden({ timeout: 5_000 });

    const next = await Promise.race([
      stopButton(page)
        .waitFor({ state: "hidden", timeout: 30_000 })
        .then(() => "settled" as const),
      approvalCard(page)
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => "permission" as const),
    ]);
    if (next === "settled") return;
  }

  throw new Error("Agent 在连续三次明确拒绝后仍继续申请替代工具权限。");
}

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 工具授权`, E2E_COVERAGE.productAgentProvider, () => {
    test("写文件前必须审批，点允许后文件真的落盘", async ({
      page,
      scratchDir,
    }) => {
      test.setTimeout(120_000);

      const target = path.join(scratchDir, "approved.txt");
      expect(await fileExists(target)).toBe(false);

      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        `请使用 Write 工具创建文件 ${target}，内容就写 APPROVED。只做这一件事。`
      );

      // 未经我同意，不允许发生写操作。
      await expect(approvalCard(page)).toBeVisible({ timeout: 45_000 });
      expect(await fileExists(target)).toBe(false);

      await page.getByRole("button", { name: "允许", exact: true }).click();

      expect(await waitForFile(target)).toBe(true);
    });

    test("点拒绝后文件不会被创建，且运行正常收敛", async ({
      page,
      scratchDir,
    }) => {
      test.setTimeout(120_000);

      const target = path.join(scratchDir, "denied.txt");

      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        `请使用 Write 工具创建文件 ${target}，内容就写 DENIED。只做这一件事。`
      );

      await expect(approvalCard(page)).toBeVisible({ timeout: 45_000 });
      await denyPendingToolRequests(page);

      // 拒绝不能只是关掉卡片：工具必须真的没执行，且运行要正常结束而非挂死。
      await expect(stopButton(page)).not.toBeVisible({ timeout: 5_000 });
      expect(await fileExists(target)).toBe(false);
    });

    test("只读操作不打扰用户，不弹审批", async ({ page }) => {
      test.setTimeout(120_000);

      await selectRuntime(page, runtime);
      const previousAssistantCount = await page.locator(".ai-message-content").count();
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

    test("切到 YOLO 模式后写文件不再拦截", async ({ page, scratchDir }) => {
      test.setTimeout(120_000);

      const target = path.join(scratchDir, "yolo.txt");

      await selectRuntime(page, runtime);

      // 权限模式按钮是循环切换：Ask → Smart → YOLO。
      const modeButton = page.getByRole("button", { name: /^当前权限模式：/ });
      await expect(modeButton).toBeVisible();
      while (!(await modeButton.getAttribute("aria-label"))?.includes("YOLO")) {
        await modeButton.click();
        await expect(modeButton).toBeEnabled();
      }

      await sendMessage(
        page,
        `请使用 Write 工具创建文件 ${target}，内容就写 YOLO。只做这一件事。`
      );

      // YOLO 下不应出现审批卡，文件应直接落盘。
      expect(await waitForFile(target)).toBe(true);
      await expect(approvalCard(page)).toHaveCount(0);
    });
  });
}
