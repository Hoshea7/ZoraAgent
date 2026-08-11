import { expect, test } from "./support/electron-fixture";

const PROJECT_ID = "sidebar-order-project";
const NOW = "2026-08-11T04:00:00.000Z";

test.use({
  workspaceSeed: {
    id: PROJECT_ID,
    name: "排序测试项目",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: "session-a",
        title: "会话 A",
        createdAt: NOW,
        updatedAt: "2026-08-11T04:03:00.000Z",
        permissionMode: "ask",
      },
      {
        id: "session-b",
        title: "会话 B",
        createdAt: NOW,
        updatedAt: "2026-08-11T04:02:00.000Z",
        permissionMode: "ask",
      },
      {
        id: "session-c",
        title: "会话 C",
        createdAt: NOW,
        updatedAt: "2026-08-11T04:01:00.000Z",
        permissionMode: "ask",
      },
    ],
  },
});

test("用户拖动会话后保持自定义顺序", async ({ page }) => {
  await page.evaluate(() => {
    window.localStorage.removeItem("zora:sessionOrder");
  });
  await page.reload();
  await page.getByRole("button", { name: "排序测试项目", exact: true }).click();

  const rows = page.locator(`[data-workspace-id="${PROJECT_ID}"] [data-session-id]`);
  await expect(rows).toHaveCount(3);
  await expect(rows).toHaveText([/会话 A/, /会话 B/, /会话 C/]);

  await page.locator('[data-session-id="session-c"]').dragTo(
    page.locator('[data-session-id="session-a"]')
  );
  await expect(rows).toHaveText([/会话 C/, /会话 A/, /会话 B/]);

  await page.reload();
  await page.getByRole("button", { name: "排序测试项目", exact: true }).click();
  await expect(rows).toHaveText([/会话 C/, /会话 A/, /会话 B/]);
});
