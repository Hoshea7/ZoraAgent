import {
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
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
  test.describe(`[${runtime}] 基础对话`, () => {
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

      // 两个 Runtime 都要把本轮真实 token 用量映射到统一产品字段并展示。
      await expect(page.locator('[data-agent-usage="true"]').last()).toContainText(
        /tokens/,
        { timeout: 120_000 }
      );

      // 运行结束后 Runtime 选择器保持可用（未被运行态卡死）。
      const runtimeSelector = page.getByRole("button", { name: "切换运行时" });
      await expect(runtimeSelector).toBeEnabled({ timeout: 120_000 });
    });

    test("用户停止长回复和待处理引导后，会话不会重新运行且仍可继续对话", async ({ page }) => {
      test.setTimeout(180_000);

      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        "请详细分步骤解释 Electron 主进程与渲染进程的完整通信机制，越详细越好。"
      );

      const stopButton = page.locator('button[title="停止"]');
      await expect(stopButton).toBeVisible({ timeout: 60_000 });

      // 等到 Runtime 已经产生输出，再追加一条运行中引导，覆盖真实的停止竞态。
      await expect(
        page.locator(".ai-process-content, .ai-message-content").first()
      ).toBeVisible({ timeout: 60_000 });
      await sendMessage(page, "补充：停止后不要继续处理这条引导。");
      await expect(
        page.getByText("补充：停止后不要继续处理这条引导。", { exact: true })
      ).toBeVisible();

      await stopButton.click();
      await expect(stopButton).not.toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(2_000);
      await expect(stopButton).not.toBeVisible();

      // 停止只结束当前运行，不应破坏会话：下一轮仍能正常收到回复。
      await sendMessage(page, "只回复这两个字：继续");
      await expect(page.locator(".ai-message-content").last()).toContainText(
        /继续/,
        { timeout: 120_000 }
      );
    });
  });
}

test("同一会话可逐轮切换 Runtime 并保留上下文", async ({ page }) => {
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
