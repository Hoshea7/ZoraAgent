import { copyFile } from "node:fs/promises";
import path from "node:path";
import {
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

const representativeFixtures = path.resolve("tests/fixtures/documents");

for (const runtime of RUNTIMES) {
  test(`[${runtime}] Agent 使用 read_document 读取真实 PDF、XLSX、PPTX，并能理解 DOCX 附件`, async ({
    electronApp,
    page,
    scratchDir,
  }) => {
    test.setTimeout(360_000);
    const pdfPath = path.join(scratchDir, "northstar-operations.pdf");
    const xlsxPath = path.join(scratchDir, "northstar-dashboard.xlsx");
    const pptxPath = path.join(scratchDir, "northstar-launch.pptx");
    const docxPath = path.join(scratchDir, "northstar-review.docx");
    await Promise.all([
      copyFile(path.join(representativeFixtures, "northstar-operations.pdf"), pdfPath),
      copyFile(path.join(representativeFixtures, "northstar-dashboard.xlsx"), xlsxPath),
      copyFile(path.join(representativeFixtures, "northstar-launch.pptx"), pptxPath),
      copyFile(path.join(representativeFixtures, "northstar-review.docx"), docxPath),
    ]);

    await selectRuntime(page, runtime);
    await sendMessage(
      page,
      `依次使用 read_document 读取以下三个文件，并逐行原样回复每个文件中包含 REALISTIC_MARKER 的完整口令：\n${pdfPath}\n${xlsxPath}\n${pptxPath}`
    );
    const processView = page.locator(".ai-process-content").last();
    await expect(processView).toContainText(/read_document|Read Document/i, {
      timeout: 120_000,
    });
    const workspaceResponse = page.locator(".ai-message-content").last();
    await expect(workspaceResponse).toContainText("PDF_REALISTIC_MARKER", {
      timeout: 180_000,
    });
    await expect(workspaceResponse).toContainText("XLSX_REALISTIC_MARKER");
    await expect(workspaceResponse).toContainText("PPTX_REALISTIC_MARKER");

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
      });
    }, docxPath);
    await page.getByRole("button", { name: "添加附件" }).click();
    await expect(page.getByTitle("northstar-review.docx")).toBeVisible();
    await sendMessage(page, "读取我附加的 DOCX，只回复包含 REALISTIC_MARKER 的完整口令。");
    await expect(page.locator(".ai-message-content").last()).toContainText(
      "DOCX_REALISTIC_MARKER",
      { timeout: 120_000 }
    );
    await expect(
      page.locator(".ai-process-content, .ai-message-content").filter({
        hasText: /\.zora\/workspaces\/.*\/sessions\/attachments/,
      })
    ).toHaveCount(0);
  });
}
