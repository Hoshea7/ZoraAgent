import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
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
}
