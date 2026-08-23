import {
  E2E_COVERAGE,
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

/**
 * 切片 0 基线：两个 Runtime 下的基础对话与工具调用。
 *
 * 断言落在 AgentTrace（过程视图）上而不是只看最终文本：真实价值在于能发现
 * "模型说了什么" 与 "产品实际做了什么" 之间的偏差——例如工具被调用但过程视图
 * 没有回显，或正文先于过程出现导致用户看到结论却看不到依据。
 */
for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 基础对话`, E2E_COVERAGE.agentProvider, () => {
    test("用户要求读文件时，先出现过程视图再出现正文，且过程中记录 Read 工具", async ({
      page,
    }) => {
      test.setTimeout(180_000);

      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后只回答该文件里的 name 字段值。`
      );

      const processView = page.locator(".ai-process-content");
      const body = page.locator(".ai-message-content").last();

      // 因果顺序：用户必须先看到"正在做什么"，再看到结论。
      const firstVisible = await Promise.race([
        processView
          .waitFor({ state: "visible", timeout: 120_000 })
          .then(() => "process" as const),
        body
          .waitFor({ state: "visible", timeout: 120_000 })
          .then(() => "body" as const),
      ]);
      expect(firstVisible).toBe("process");

      // 工具真的被调用，并以 canonical 名字回显给用户。
      await expect(processView).toContainText("Read", { timeout: 120_000 });

      // 模型基于工具结果作答，而不是凭空回答。
      await expect(body).toContainText(/zora/i, { timeout: 120_000 });

      // 运行结束后 Runtime 选择器保持可用（未被运行态卡死）。
      const runtimeSelector = page.getByRole("button", { name: "切换运行时" });
      await expect(runtimeSelector).toBeEnabled({ timeout: 120_000 });
    });

    test("用户修改已发送的 query 后，后续内容被截断并按新 query 重新运行", async ({
      page,
    }) => {
      test.setTimeout(300_000);

      const originalQuery = `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后只回复这个标识：ORIGINAL_QUERY_31415`;
      const laterQuery = "只回复这个标识：LATER_QUERY_27182";
      const revisedQuery = `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后只回复这个标识：REVISED_QUERY_92653`;
      const expectReadBeforeAnswer = async (
        expectedText: string,
        previousAssistantCount: number
      ) => {
        const processView = page.locator(".ai-process-content").last();
        const body = page.locator(".ai-message-content").last();
        const firstVisible = await Promise.race([
          processView
            .waitFor({ state: "visible", timeout: 120_000 })
            .then(() => "process" as const),
          body
            .waitFor({ state: "visible", timeout: 120_000 })
            .then(() => "body" as const),
        ]);
        expect(firstVisible).toBe("process");
        await expect(processView).toContainText("Read", { timeout: 120_000 });
        await expectAssistantTextUntilSettled(
          page,
          expectedText,
          previousAssistantCount,
          120_000
        );
      };

      await selectRuntime(page, runtime);
      await sendMessage(page, originalQuery);
      await expectReadBeforeAnswer("ORIGINAL_QUERY_31415", 0);

      await sendMessage(page, laterQuery);
      await expectAssistantTextUntilSettled(
        page,
        "LATER_QUERY_27182",
        1,
        120_000
      );

      const conversationLog = page.getByRole("log");
      const originalMessage = conversationLog
        .getByRole("article")
        .filter({ hasText: originalQuery });
      await originalMessage.hover();
      await originalMessage.getByRole("button", { name: "修改消息" }).click();
      const editor = page.getByRole("textbox", { name: "编辑消息" });
      await editor.fill(revisedQuery);
      await editor
        .locator("..")
        .getByRole("button", { name: "发送", exact: true })
        .click();

      await expectReadBeforeAnswer("REVISED_QUERY_92653", 0);

      await expect(
        conversationLog.getByText(originalQuery, { exact: true })
      ).toHaveCount(0);
      await expect(
        conversationLog.getByText(laterQuery, { exact: true })
      ).toHaveCount(0);
      await expect(page.locator(".ai-message-content")).not.toContainText(
        "ORIGINAL_QUERY_31415"
      );
      await expect(page.locator(".ai-message-content")).not.toContainText(
        "LATER_QUERY_27182"
      );
      await expect(
        conversationLog.getByText(revisedQuery, { exact: true })
      ).toBeVisible();

      const sessionId = await page
        .locator("[data-session-id]")
        .first()
        .getAttribute("data-session-id");
      expect(sessionId).toBeTruthy();
      await page.reload();
      await page.locator(`[data-session-id="${sessionId}"]`).click();
      const reloadedLog = page.getByRole("log");
      await expect(
        reloadedLog.getByText(revisedQuery, { exact: true })
      ).toBeVisible();
      await expect(
        reloadedLog.getByText(originalQuery, { exact: true })
      ).toHaveCount(0);
      await expect(
        reloadedLog.getByText(laterQuery, { exact: true })
      ).toHaveCount(0);
    });
  });
}

test("同一会话可逐轮切换 Runtime 并保留上下文", E2E_COVERAGE.productAgentProvider, async ({ page }) => {
  test.setTimeout(240_000);

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    "请记住这个口令：ZORA_ALPHA_7788。只回复「已记住」两个字。"
  );
  await expect(page.locator(".ai-message-content").last()).toContainText(
    /已记住|记住/,
    { timeout: 120_000 }
  );

  // 换引擎后，对话真相由产品层持有，上下文不应断裂。
  await selectRuntime(page, "claude");
  await sendMessage(
    page,
    "请再记住第二个口令 ZORA_BETA_9911，然后只回复我前面让你记住的第一个口令。"
  );
  await expect(page.locator(".ai-message-content").last()).toContainText(
    "ZORA_ALPHA_7788",
    { timeout: 120_000 }
  );

  // 再切回 Pi，Pi Adapter 会重开原生 checkpoint，并补入 Claude 产生的可见历史。
  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    "请按顺序回复我让你记住的两个口令，中间用空格分隔。"
  );
  await expect(page.locator(".ai-message-content").last()).toContainText(
    /ZORA_ALPHA_7788[\s\S]*ZORA_BETA_9911/i,
    { timeout: 120_000 }
  );
});
