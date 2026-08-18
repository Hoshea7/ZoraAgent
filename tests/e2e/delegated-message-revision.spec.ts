import {
  PACKAGE_JSON_PATH,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

const WORKSPACE_ID = "delegated-revision-workspace";
const PARENT_SESSION_ID = "delegated-revision-parent";
const CHILD_SESSION_ID = "delegated-revision-child";
const NOW = "2026-08-14T12:00:00.000Z";
const CHILD_QUERY = "只回复这个标识：CHILD_ORIGINAL_48172";
const REVISED_CHILD_QUERY = `刚才的要求需要修改。请打开 ${PACKAGE_JSON_PATH} 确认项目内容，确认后只回复这个标识：CHILD_REVISED_63904`;
const PARENT_QUERY = "父会话历史保持不变：PARENT_HISTORY_20716";

test.use({
  workspaceSeed: {
    id: WORKSPACE_ID,
    name: "委派消息修改测试",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: CHILD_SESSION_ID,
        title: "可修改的委派会话",
        createdAt: NOW,
        updatedAt: NOW,
        permissionMode: "ask",
        parentSessionId: PARENT_SESSION_ID,
        rootSessionId: PARENT_SESSION_ID,
        delegationDepth: 1,
        delegationRole: "explore",
        delegationGoal: "验证委派会话消息修改",
        delegationStatus: "completed",
        delegationRunId: "delegated-revision-run",
        delegationAttempt: 1,
        delegationRevision: 1,
      },
      {
        id: PARENT_SESSION_ID,
        title: "委派父会话",
        createdAt: NOW,
        updatedAt: NOW,
        permissionMode: "ask",
      },
    ],
    sessionMessages: {
      [PARENT_SESSION_ID]: [
        {
          id: "parent-user",
          role: "user",
          text: PARENT_QUERY,
          timestamp: 1,
        },
      ],
      [CHILD_SESSION_ID]: [],
    },
  },
});

test("用户修改委派子会话 query 时，父会话历史保持不变", async ({ page }) => {
  test.setTimeout(180_000);

  const openChildSession = async () => {
    const projectButton = page.getByRole("button", {
      name: "委派消息修改测试",
      exact: true,
    });
    if ((await projectButton.getAttribute("aria-expanded")) !== "true") {
      await projectButton.click();
    }
    const childRow = page.locator(`[data-session-id="${CHILD_SESSION_ID}"]`);
    if (!(await childRow.isVisible())) {
      await page
        .locator(`[data-session-id="${PARENT_SESSION_ID}"]`)
        .getByRole("button", { name: "展开子任务" })
        .click();
    }
    await childRow.click();
  };

  await openChildSession();
  await selectRuntime(page, "claude");
  await sendMessage(page, CHILD_QUERY);
  await expectAssistantTextUntilSettled(
    page,
    "CHILD_ORIGINAL_48172",
    0,
    120_000
  );

  const conversationLog = page.getByRole("log");
  const originalMessage = conversationLog
    .getByRole("article")
    .filter({ hasText: CHILD_QUERY });
  await originalMessage.hover();
  await originalMessage.getByRole("button", { name: "修改消息" }).click();
  const editor = page.getByRole("textbox", { name: "编辑消息" });
  await editor.fill(REVISED_CHILD_QUERY);
  await editor
    .locator("..")
    .getByRole("button", { name: "发送", exact: true })
    .click();

  const processView = page.locator(".ai-process-content").last();
  await expect(processView).toContainText("Read", { timeout: 120_000 });
  await expectAssistantTextUntilSettled(
    page,
    "CHILD_REVISED_63904",
    0,
    120_000
  );
  await expect(conversationLog.getByText(CHILD_QUERY, { exact: true })).toHaveCount(0);
  await expect(
    conversationLog.getByText(REVISED_CHILD_QUERY, { exact: true })
  ).toBeVisible();

  await page.reload();
  await openChildSession();
  await expect(
    page.getByRole("log").getByText(REVISED_CHILD_QUERY, { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("log").getByText(CHILD_QUERY, { exact: true })).toHaveCount(0);

  await page.locator(`[data-session-id="${PARENT_SESSION_ID}"]`).click();
  await expect(page.getByRole("log").getByText(PARENT_QUERY, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("log").getByText(REVISED_CHILD_QUERY, { exact: true })
  ).toHaveCount(0);
});
