import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户从较早回复 Fork 后，新分支只继承 Fork 点之前的上下文`, E2E_COVERAGE.productAgentProvider, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const inherited = `FORK_ALPHA_${runtime.toUpperCase()}_7788`;
    const excluded = `FORK_BETA_${runtime.toUpperCase()}_9911`;

    await selectRuntime(page, runtime);
    await sendMessage(
      page,
      `不要使用任何工具，也不要写入文件。仅在当前对话中记住口令 ${inherited}，只回复「已记住」。`
    );
    await expect(page.locator(".ai-message-content").last()).toContainText(
      /记住/,
      { timeout: 120_000 }
    );

    await sendMessage(
      page,
      `不要使用任何工具，也不要写入文件。再记住口令 ${excluded}，只回复「已记住」。`
    );
    await expect(page.locator(".ai-message-content")).toHaveCount(2, {
      timeout: 120_000,
    });

    const assistantArticles = page.locator("article").filter({
      has: page.locator(".ai-message-content"),
    });
    await assistantArticles.first().getByRole("button", {
      name: "Fork 会话",
    }).click();

    // Fork 完成后自动进入新分支，第二轮消息不再展示。
    await expect(page.locator(".ai-message-content")).toHaveCount(1, {
      timeout: 60_000,
    });
    await sendMessage(
      page,
      "只回复这个分支里我让你记住的口令，不要补充说明。"
    );
    const answer = page.locator(".ai-message-content").last();
    await expect(answer).toContainText(inherited, { timeout: 120_000 });
    await expect(answer).not.toContainText(excluded);
  });
}
