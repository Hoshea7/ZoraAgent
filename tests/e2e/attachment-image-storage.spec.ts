import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  E2E_COVERAGE,
  expect,
  restartElectronApplication,
  selectModel,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

// 真实用户流程：用户选择一张图片作为附件。图片附件的运行时状态只保留
// 缩略图预览，原图存盘，Agent 通过 Read 读取磁盘原图识别内容。应用重启
// 后，历史消息的缩略图预览从落盘缩略图恢复，不再依赖原图驻留内存。
test("用户发送图片附件后 Agent 读取磁盘原图识别颜色，重启后缩略图预览仍在", E2E_COVERAGE.productAgentProvider, async ({
  electronApp,
  page,
  scratchDir,
}) => {
  test.setTimeout(180_000);
  const imageName = "orange-card.png";
  const imagePath = path.join(scratchDir, imageName);
  await writeFile(
    imagePath,
    await sharp({
      create: { width: 320, height: 200, channels: 3, background: "#e8590c" },
    })
      .png()
      .toBuffer()
  );

  await electronApp.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath],
    });
  }, imagePath);

  await selectRuntime(page, "claude");
  // 测试 HOME 显式配置了支持图片输入的模型，Agent 使用原生 Read 读磁盘原图。
  await selectModel(page, process.env.ZORA_E2E_IMAGE_MODEL_ID?.trim() || "minimax-m3");

  await page.getByRole("button", { name: "添加附件" }).click();
  await expect(
    page.getByRole("button", { name: `移除附件 ${imageName}` })
  ).toBeVisible();
  // 缩略图预览立即可见（原图字节不再进入运行时状态）。
  const draftPreview = page
    .locator(`button[title="查看图片 ${imageName}"] img`);
  await expect(draftPreview).toBeVisible();

  await sendMessage(
    page,
    "读取我附加的图片，只回复图片的主色，用一个中文颜色词回答。"
  );

  await expect(
    page.locator(".ai-process-content").filter({ hasText: /Read/i }).last()
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".ai-message-content").last()).toContainText(
    /橙|橘|orange/i,
    { timeout: 90_000 }
  );

  const restarted = await restartElectronApplication(electronApp);
  try {
    const sessionButton = restarted.page
      .locator("button, [role='button'], a")
      .filter({ hasText: "读取我附加的图片" })
      .first();
    await expect(sessionButton).toBeVisible({ timeout: 30_000 });
    await sessionButton.click();

    // 重启后历史用户消息的缩略图预览从落盘缩略图恢复。
    await expect(
      restarted.page.locator(`button[title="查看图片 ${imageName}"] img`)
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await restarted.electronApp.close();
  }
});
