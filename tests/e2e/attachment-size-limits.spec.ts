import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createLargePdfFixture } from "../helpers/document-fixtures";
import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  setNextOpenDialogPath,
  sendMessage,
  test,
} from "./support/electron-fixture";

// 真实用户流程：用户选择一个超过旧 10MB 上限、但落在 PDF 64MB 档内的
// 大型 PDF 作为附件发送。此前这个文件会在入口被直接拒收；分层限制生效后，
// 附件应该成功挂载，并且 Agent 能通过 read_document 真实读取到第一页末尾
// 的口令（口令刻意放在附件投影 4KB 预览之外，工具调用是拿到它的唯一路径）。
for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户发送超过 10MB 的 PDF 附件，Agent 通过 read_document 读到口令`, E2E_COVERAGE.productAgentProvider, async ({
    electronApp,
    page,
    scratchDir,
  }) => {
    test.setTimeout(180_000);
    const token = `ZORA_BIGPDF_${runtime.toUpperCase()}_7788`;
    const pdfPath = path.join(scratchDir, `large-${runtime}.pdf`);
    // ~17MB 文本密集 PDF，旧的一刀切 10MB 入口限制会拒收它。
    await writeFile(pdfPath, createLargePdfFixture(420, token));

    await setNextOpenDialogPath(electronApp, pdfPath);

    await selectRuntime(page, runtime);
    await page.getByRole("button", { name: "添加附件" }).click();
    await expect(page.getByTitle(`large-${runtime}.pdf`)).toBeVisible();

    const previousAssistantCount = await page
      .locator("[data-assistant-message='true']")
      .count();
    await sendMessage(
      page,
      "读取我附加的 PDF。第一页末尾有一个以 TOKEN 开头的口令，只调用 read_document 读取第一页，不得调用 Bash 或其他工具，并只回复这个口令本身。"
    );

    await Promise.race([
      expectAssistantTextUntilSettled(
        page,
        token,
        previousAssistantCount,
        150_000,
      ),
      page
        .getByTestId("permission-banner")
        .waitFor({ state: "visible", timeout: 150_000 })
        .then(async () => {
          const permissionText = await page
            .getByTestId("permission-banner")
            .textContent();
          throw new Error(
            `读取 PDF 时出现了不需要的权限请求：${permissionText ?? "未知工具"}`,
          );
        }),
    ]);
    const process = page.locator(".ai-process-content").last();
    const processToggle = process.getByRole("button").first();
    await expect(processToggle).toContainText(/工具调用/, { timeout: 5_000 });
    if ((await processToggle.getAttribute("aria-expanded")) !== "true") {
      await processToggle.click();
    }
    await expect(process.getByTestId("agent-activity")).toContainText(
      /read_document/i,
      { timeout: 5_000 },
    );
  });
}
