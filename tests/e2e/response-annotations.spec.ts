import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectProviderModel,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

for (const runtime of RUNTIMES) {
  test(
    `[${runtime}] Agent 根据划词批注内容给出反馈`,
    E2E_COVERAGE.productAgentProvider,
    async ({ page }) => {
      test.setTimeout(240_000);
      const sourceToken = `ANNOTATION_SOURCE_${runtime.toUpperCase()}_31415`;
      const commentToken = `ANNOTATION_COMMENT_${runtime.toUpperCase()}_92653`;

      await selectRuntime(page, runtime);
      await selectProviderModel(
        page,
        "火山-normal",
        "doubao-seed-2-1-pro-260628",
      );
      await sendMessage(
        page,
        `不要使用任何工具。只回复这一行口令，不要添加其他文字：${sourceToken}`,
      );
      await expectAssistantTextUntilSettled(page, sourceToken, 0, 120_000);

      const sourceBody = page.locator(".ai-message-content").last();
      const box = await sourceBody.boundingBox();
      expect(box).not.toBeNull();
      const y = box!.y + box!.height / 2;
      await page.mouse.move(box!.x + 4, y);
      await page.mouse.down();
      await page.mouse.move(box!.x + Math.min(box!.width - 4, 260), y, {
        steps: 16,
      });
      await page.mouse.up();

      await page.getByRole("button", { name: "添加批注" }).click();
      await page
        .getByRole("textbox", { name: "批注评论" })
        .fill(`不要使用工具，只回复口令 ${commentToken}`);
      await page.getByRole("button", { name: "添加", exact: true }).click();
      await expect(page.getByTestId("draft-response-annotations")).toContainText(
        "1 条批注",
      );

      await page.getByTitle("发送").click();
      await expectAssistantTextUntilSettled(page, commentToken, 1, 120_000);

      const sentMessage = page.locator("article").filter({
        hasText: "请基于以下评论批注内容给出反馈。",
      });
      await expect(sentMessage).toBeVisible();
      await sentMessage.getByText("1 条批注", { exact: true }).click();
      await expect(sentMessage).toContainText(commentToken);
    },
  );
}
