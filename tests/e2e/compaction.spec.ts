import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test.use({ providerContextWindow: 20_000 });

test("手动压缩在上下文过小时提示无需压缩且不创建 Agent Turn", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await selectRuntime(page, "pi");
  await sendMessage(page, "只回复：压缩准入测试完成");
  await expect(page.locator(".ai-message-content").last()).toContainText(
    "压缩准入测试完成",
    { timeout: 120_000 }
  );
  await expect(page.locator('button[title="停止"]')).toBeHidden({
    timeout: 30_000,
  });

  const assistantTurns = await page.locator(".ai-message-content").count();
  const processTurns = await page.locator(".ai-process-content").count();
  const contextBadge = page.getByLabel(/上下文窗口已使用 \d+%/);
  await contextBadge.click();
  await page.getByRole("button", { name: "手动压缩" }).click();
  await page.getByRole("button", { name: "再次点击确认" }).click();

  const notice = page.getByRole("status").filter({
    hasText: "当前上下文无需压缩",
  });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  expect(await page.locator(".ai-message-content").count()).toBe(assistantTurns);
  expect(await page.locator(".ai-process-content").count()).toBe(processTurns);
  await expect(notice).toBeHidden({ timeout: 5_000 });
});

test("Pi 在同一 Agent Turn 结束前完成压缩并保留最终结果", async ({
  page,
  scratchDir,
  zoraHome,
}) => {
  test.setTimeout(300_000);

  const marker = "ZORA_COMPACTION_CONTINUED_8842";
  const sourcePath = path.join(scratchDir, "large-context.txt");
  await writeFile(
    sourcePath,
    `${marker}\n${"用于上下文压缩测试的确定性内容。\n".repeat(8_000)}`,
    "utf8"
  );

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    `使用 Read 工具完整读取 ${sourcePath}。读取后只回复文件第一行的口令，不要提前猜测。`
  );

  const processView = page.locator(".ai-process-content");
  await expect(processView).toContainText("Read", { timeout: 120_000 });
  await expect(processView).toContainText("正在整理上下文", { timeout: 180_000 });
  await expect(page.locator('button[title="停止"]')).toBeVisible();
  await expect(page.locator(".ai-message-content").last()).toContainText(marker, {
    timeout: 240_000,
  });
  await expect(page.locator('button[title="停止"]')).toBeHidden({
    timeout: 60_000,
  });

  await expect(page.getByLabel(/上下文窗口已使用 \d+%/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/任务未能完成|请发送“继续”/)).toHaveCount(0);

  const runtimeRoot = path.join(
    zoraHome,
    "workspaces",
    "default",
    "sessions",
    "runtime",
    "pi"
  );
  await mkdir(runtimeRoot, { recursive: true });
  const checkpoints = await readdir(runtimeRoot);
  expect(checkpoints.length).toBeGreaterThan(0);
});
