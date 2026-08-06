import { expect, test } from "./support/electron-fixture";
import path from "node:path";

test.skip(process.env.ZORA_E2E_LIVE !== "1", "仅在 test:e2e:live 中调用真实 Provider");

test("@live 用户通过 Pi Runtime 完成真实模型文件读取", async ({ page }) => {
  test.setTimeout(60_000);
  const runtimeSelector = page.getByRole("button", { name: "切换运行时" });
  await expect(runtimeSelector).toContainText("Pi");

  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  const packageJsonPath = path.join(process.cwd(), "package.json");
  await composer.fill(
    `You must call the read tool to read ${packageJsonPath}. Then reply with the package name.`
  );
  await composer.press("Enter");

  const processView = page.locator(".ai-process-content");
  const assistantBody = page.locator(".ai-message-content").last();
  const firstVisiblePhase = await Promise.race([
    processView.waitFor({ state: "visible", timeout: 45_000 }).then(() => "process" as const),
    assistantBody.waitFor({ state: "visible", timeout: 45_000 }).then(() => "body" as const),
  ]);
  expect(firstVisiblePhase).toBe("process");
  await expect(processView).toContainText("Read", { timeout: 45_000 });
  await expect(assistantBody).toContainText(/zora/i, {
    timeout: 45_000,
  });
  await expect(runtimeSelector).toContainText("Pi");
  await expect(runtimeSelector).toBeEnabled();
});
