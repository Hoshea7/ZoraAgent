import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户通过附件按钮发送文本文件后，Agent 能读取文件内容`, async ({
    electronApp,
    page,
    scratchDir,
  }) => {
    test.setTimeout(180_000);
    const token = `ZORA_ATTACHMENT_${runtime.toUpperCase()}_7788`;
    const attachmentPath = path.join(scratchDir, `attachment-${runtime}.txt`);
    await writeFile(attachmentPath, token, "utf8");

    // 保留完整可见用户流程，只固定系统文件选择器返回本用例的隔离文件。
    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
      });
    }, attachmentPath);

    await selectRuntime(page, runtime);
    await page.getByRole("button", { name: "添加附件" }).click();
    await expect(page.getByTitle(`attachment-${runtime}.txt`)).toBeVisible();

    await sendMessage(page, "读取我附加的文本文件，只回复文件中的口令。");

    await expect(page.locator(".ai-message-content").last()).toContainText(
      token,
      { timeout: 120_000 }
    );
  });

  test(`[${runtime}] 用户可在 Agent 运行中发送带图片的引导消息`, async ({
    electronApp,
    page,
    scratchDir,
  }) => {
    test.setTimeout(180_000);
    const imageName = `guidance-${runtime}.png`;
    const imagePath = path.join(scratchDir, imageName);
    await writeFile(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAKAAAABQCAIAAAARP+ljAAAAk0lEQVR42u3RQREAAAjDsIF/z2CCH6mDXmoy+VT92k1HgAVYgAVYgAVYgAELsAALsAALsAADFmABFmABFmABFmDAAizAAizAAizAgAVYgAVYgAVYgAELsAALsAALsAALMGABFmABFmABFmDAAizAAizAAizAgAVYgAVYgAVYgAUYsAALsAALsAALMGABFmABFmAdtXnFA56+yU9NAAAAAElFTkSuQmCC",
        "base64"
      )
    );

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
      });
    }, imagePath);

    await selectRuntime(page, runtime);
    await sendMessage(
      page,
      `先使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后逐项详细解释 scripts 字段。`
    );
    const stopButton = page.locator('button[title="停止"]');
    await expect(stopButton).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ai-process-content").last()).toContainText("Read", {
      timeout: 120_000,
    });

    await page.getByRole("button", { name: "添加附件" }).click();
    await expect(page.getByRole("button", { name: `移除附件 ${imageName}` })).toBeVisible();

    const guidance =
      "停止上一项任务。观察这张图片，按从左到右的顺序，只用两个英文大写颜色单词回复。";
    await sendMessage(page, guidance);

    const queuedMessage = page.locator("article").filter({ hasText: guidance }).last();
    await expect(queuedMessage).toBeVisible({ timeout: 30_000 });
    await expect(queuedMessage.getByTitle(imageName, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `移除附件 ${imageName}` })
    ).toHaveCount(0);
    const guidedResponse = queuedMessage.locator("xpath=following-sibling::article[1]");
    await expect(guidedResponse).toContainText(/MAGENTA[\s,，/、]+CYAN/i, {
      timeout: 180_000,
    });
  });
}
