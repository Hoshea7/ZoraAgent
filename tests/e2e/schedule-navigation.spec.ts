import { expect, test } from "./support/electron-fixture";

const NOW = "2026-08-14T08:00:00.000Z";
const PROJECT_ID = "schedule-navigation-project";
const SESSION_ID = "schedule-navigation-session";
const SESSION_TITLE = "定时页面返回会话检查";

test.use({
  workspaceSeed: {
    id: PROJECT_ID,
    name: "导航检查项目",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: SESSION_ID,
        title: SESSION_TITLE,
        createdAt: NOW,
        updatedAt: NOW,
        permissionMode: "ask",
      },
    ],
    sessionMessages: {
      [SESSION_ID]: [
        {
          id: "schedule-navigation-message",
          role: "user",
          text: "用于检查定时页面返回会话。",
          timestamp: Date.parse(NOW),
        },
      ],
    },
  },
});

test("进入定时任务后可以选择历史会话并新建会话", async ({ page }) => {
  await page.getByRole("button", { name: "定时", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "定时任务", exact: true })
  ).toBeVisible();

  await page.locator(`[data-session-id="${SESSION_ID}"]`).click();
  await expect(page.getByRole("heading", { name: SESSION_TITLE })).toBeVisible();

  await page.getByRole("button", { name: "定时", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "定时任务", exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "新会话", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新会话" })).toBeVisible();
});
