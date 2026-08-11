import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test("不支持图片的 Pi 主模型通过视觉中转理解图片", async ({
  electronApp,
  page,
  scratchDir,
}) => {
  test.setTimeout(120_000);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await page.locator("summary").filter({ hasText: "图片能力识别" }).click();
  const mainCapability = page.getByRole("combobox", {
    name: /glm-5\.2 图片能力/,
  }).first();
  await mainCapability.selectOption("unsupported");

  await page.getByRole("button", { name: "视觉助手", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "启用视觉中转" });
  await toggle.click();
  const modelSelector = page.getByRole("button", { name: "选择视觉模型" });
  await modelSelector.click();
  await page.getByRole("menuitem").filter({ hasText: "minimax-m3" }).click();
  await expect(modelSelector).toContainText("minimax-m3");
  await page.getByTitle("关闭设置 (Esc)").click();

  await selectRuntime(page, "pi");
  const imageName = "vision-relay.png";
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

  await page.getByRole("button", { name: "添加附件" }).click();
  await sendMessage(
    page,
    "观察这张图片，按从左到右的顺序，只用两个英文大写颜色单词回复。"
  );

  await expect(
    page.locator(".ai-process-content").filter({ hasText: /Inspect Image|inspect_image/i })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ai-message-content").last()).toContainText(
    /MAGENTA[\s,，/、]+CYAN/i,
    { timeout: 90_000 }
  );
  await expect(
    page.getByRole("heading", { name: /需要 .*inspect_image 执行权限/i })
  ).toHaveCount(0);
});
