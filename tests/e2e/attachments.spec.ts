import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  loadRealProviders,
  selectProviderModel,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户通过附件按钮发送文本文件后，Agent 能读取文件内容`, E2E_COVERAGE.productAgentProvider, async ({
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

  test(`[${runtime}] 用户可在 Agent 运行中发送带图片的引导消息`, E2E_COVERAGE.productAgentProvider, async ({
    electronApp,
    page,
    scratchDir,
  }) => {
    test.setTimeout(90_000);
    const providers = await loadRealProviders();
    const imageProvider = providers[0]!;
    const requestedImageModelId =
      process.env.ZORA_E2E_IMAGE_MODEL_ID?.trim() || "minimax-m3";
    const imageModel = imageProvider.models.find(
      (model) => model.enabled && model.id === requestedImageModelId
    );
    expect(imageModel).toBeTruthy();
    const imageName = `guidance-${runtime}.png`;
    const imagePath = path.join(scratchDir, imageName);
    await sharp(
      Buffer.from(`
        <svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
          <rect width="400" height="400" fill="#ff00ff" />
          <rect x="400" width="400" height="400" fill="#00ffff" />
          <text x="200" y="220" text-anchor="middle" font-family="Arial" font-size="72" font-weight="700" fill="#ffffff">MAGENTA</text>
          <text x="600" y="220" text-anchor="middle" font-family="Arial" font-size="72" font-weight="700" fill="#111111">CYAN</text>
        </svg>
      `)
    )
      .png()
      .toFile(imagePath);

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
      });
    }, imagePath);

    await selectRuntime(page, runtime);
    // 测试 HOME 通过显式能力覆盖确认该模型支持图片输入，因此应使用原生 Read。
    await selectProviderModel(page, imageProvider.name, imageModel!.id);
    const modeButton = page.getByRole("button", { name: /^当前权限模式：/ });
    while (!(await modeButton.getAttribute("aria-label"))?.includes("YOLO")) {
      await modeButton.click();
      await expect(modeButton).toBeEnabled();
    }
    await sendMessage(
      page,
      '必须使用 Bash 原样执行 node -e "setTimeout(() => console.log(\'LONG_TASK_READY\'), 4000)"，拿到输出后只回复 LONG_TASK_DONE。'
    );
    const stopButton = page.locator('button[title="停止"]');
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
    // Bash 在隔离目录内稳定运行四秒，为运行中引导保留确定性的提交窗口。
    await expect(page.locator(".ai-process-content").first()).toContainText(
      "Bash",
      { timeout: 15_000 },
    );

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
    const guidanceProcess = page.locator(".ai-process-content").last();
    const guidanceProcessToggle = guidanceProcess.getByRole("button").first();
    if ((await guidanceProcessToggle.getAttribute("aria-expanded")) !== "true") {
      await guidanceProcessToggle.click();
    }
    await expect(guidanceProcess.getByTestId("agent-activity")).toContainText(
      "Read",
      { timeout: 30_000 },
    );
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
