import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test.use({ providerContextWindow: 27_000 });

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
