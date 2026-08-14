import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
  selectModel,
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
    test.setTimeout(90_000);
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
      { timeout: 60_000 }
    );
  });

  test(`[${runtime}] 用户可在 Agent 运行中发送带图片的引导消息`, async ({
    electronApp,
    page,
    scratchDir,
  }) => {
    test.setTimeout(90_000);
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
    // 测试 HOME 通过显式能力覆盖确认该模型支持图片输入，因此应使用原生 Read。
    await selectModel(page, process.env.ZORA_E2E_IMAGE_MODEL_ID?.trim() || "minimax-m3");
    await sendMessage(
      page,
      `请对 ${PACKAGE_JSON_PATH} 做一次长程分析：先读取文件，再逐项分析全部 scripts、dependencies 和 devDependencies 的用途、风险与优化建议，最后形成完整报告。`
    );
    const stopButton = page.locator('button[title="停止"]');
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
    // 在首个 thinking/text 事件出现后发送，覆盖真实的运行中引导链路。
    await expect(
      page.locator(".ai-process-content, .ai-message-content").first()
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "添加附件" }).click();
    await expect(page.getByRole("button", { name: `移除附件 ${imageName}` })).toBeVisible();

    const guidance =
      "停止上一项任务。观察这张图片，按从左到右的顺序，只用两个英文大写颜色单词回复。";
    await sendMessage(page, guidance);

    const queuedMessage = page.locator("article").filter({ hasText: guidance }).last();
    await expect(queuedMessage).toBeVisible({ timeout: 15_000 });
    await expect(queuedMessage.getByTitle(imageName, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `移除附件 ${imageName}` })
    ).toHaveCount(0);
    // MessageList 消息按顺序渲染，用户消息与 Assistant Turn 是直接兄弟节点。
    const guidedResponse = page
      .locator(".ai-message-content")
      .filter({ hasText: /MAGENTA[\s,，/、]+CYAN/i })
      .last();
    await expect(guidedResponse).toContainText(/MAGENTA[\s,，/、]+CYAN/i, {
      timeout: 60_000,
    });
    await expect(
      page.locator(".ai-process-content").filter({ hasText: /Read/i }).last()
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator(".ai-process-content").filter({ hasText: /Inspect Image|inspect_image/i })
    ).toHaveCount(0);
    await expect(
      page.locator(".ai-process-content").filter({
        hasText: /\.zora\/workspaces\/.*\/sessions\/attachments/,
      })
    ).toHaveCount(0);
    const [guidanceBox, responseBox] = await Promise.all([
      queuedMessage.boundingBox(),
      guidedResponse.boundingBox(),
    ]);
    expect(guidanceBox).not.toBeNull();
    expect(responseBox).not.toBeNull();
    expect(responseBox!.y).toBeGreaterThan(guidanceBox!.y);
  });
}
