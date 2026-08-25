import path from "node:path";
import sharp from "sharp";
import {
  E2E_COVERAGE,
  expect,
  loadRealProviders,
  selectProviderModel,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test("不支持图片的 Pi 主模型通过视觉中转理解图片", E2E_COVERAGE.productAgentProvider, async ({
  electronApp,
  page,
  scratchDir,
}) => {
  test.setTimeout(120_000);

  const providers = await loadRealProviders();
  const mainProvider = providers[0]!;
  const mainModel =
    mainProvider.models.find((model) => model.enabled && model.id === "glm-5.2") ??
    mainProvider.models.find((model) => model.enabled)!;
  const relayProvider =
    providers.find((provider) =>
      provider.models.some((model) => model.enabled && model.id === "minimax-m3")
    ) ?? mainProvider;
  const relayModel =
    relayProvider.models.find((model) => model.enabled && model.id === "minimax-m3") ??
    relayProvider.models.find((model) => model.enabled)!;

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await page.locator("summary").filter({ hasText: "图片能力识别" }).click();
  const mainCapability = page.getByRole("combobox", {
    name: `${mainProvider.name} ${mainModel.id} 图片能力`,
  });
  await mainCapability.selectOption("unsupported");
  await expect(mainCapability).toHaveValue("unsupported");

  await page.getByRole("button", { name: "视觉助手", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "启用视觉中转" });
  await toggle.click();
  const modelSelector = page.getByRole("button", { name: "选择视觉模型" });
  await modelSelector.click();
  const relayProviderGroup = page
    .getByRole("menu")
    .last()
    .getByText(relayProvider.name, { exact: true })
    .locator("..");
  await relayProviderGroup
    .getByRole("menuitem")
    .filter({ hasText: relayModel.id })
    .click();
  await expect(modelSelector).toContainText(
    `${relayProvider.name} · ${relayModel.id}`
  );
  await page.getByTitle("关闭设置 (Esc)").click();

  await selectRuntime(page, "pi");
  await selectProviderModel(page, mainProvider.name, mainModel.id);
  const imageName = "vision-relay.png";
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

  await page.getByRole("button", { name: "添加附件" }).click();
  await expect(
    page.getByRole("button", { name: `移除附件 ${imageName}` })
  ).toBeVisible();
  await sendMessage(
    page,
    "观察这张图片。回复必须恰好包含从左到右两个英文大写颜色单词，不要翻译成中文，不要遗漏任一半。"
  );

  await expect(page.locator(".ai-message-content").last()).toContainText(
    /MAGENTA[\s,，/、]+CYAN/i,
    { timeout: 90_000 }
  );
  const processView = page.locator(".ai-process-content").last();
  const processToggle = processView.getByRole("button").first();
  if ((await processToggle.getAttribute("aria-expanded")) !== "true") {
    await processToggle.click();
  }
  await expect(processView.getByTestId("agent-activity")).toContainText(
    "Inspect Image",
    { timeout: 30_000 }
  );
  await expect(
    page.getByRole("heading", { name: /需要 .*inspect_image 执行权限/i })
  ).toHaveCount(0);
});
