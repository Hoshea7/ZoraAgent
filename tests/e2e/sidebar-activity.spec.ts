import { E2E_COVERAGE, expect, test } from "./support/electron-fixture";

const PROJECT_ID = "sidebar-activity-project";
const now = new Date();
const todayOlder = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
const todayNewer = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
const yesterday = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate() - 1,
  12,
).toISOString();

test.use({
  workspaceSeed: {
    id: PROJECT_ID,
    name: "活动测试项目",
    createdAt: todayOlder,
    updatedAt: todayNewer,
    sessions: [
      {
        id: "activity-today-older",
        title: "今天较早会话",
        createdAt: todayOlder,
        updatedAt: todayOlder,
        permissionMode: "ask",
      },
      {
        id: "activity-yesterday",
        title: "昨天会话",
        createdAt: yesterday,
        updatedAt: yesterday,
        permissionMode: "ask",
      },
      {
        id: "activity-today-newer",
        title: "今天最近会话",
        createdAt: todayNewer,
        updatedAt: todayNewer,
        permissionMode: "ask",
      },
    ],
  },
});

test(
  "用户切换活动视图后按日期和新鲜度查看会话",
  E2E_COVERAGE.productLocal,
  async ({ page }) => {
    await page.getByRole("button", { name: "查看活动" }).click();

    const activityView = page.getByTestId("activity-view");
    await expect(activityView).toBeVisible();
    const priorityHeading = activityView.getByRole("heading", { name: "优先级" });
    await expect(priorityHeading).toBeVisible();
    await expect(priorityHeading).toHaveCSS("font-size", "13px");
    await expect(activityView.getByText("整理", { exact: true })).toHaveCount(0);
    await expect(activityView.getByText("暂无需要关注的会话")).toBeVisible();
    await expect(activityView.getByRole("heading", { name: "今天" })).toBeVisible();
    await expect(activityView.getByRole("heading", { name: "昨天" })).toBeVisible();

    const rows = activityView.locator('[data-session-view="activity"]');
    await expect(rows).toHaveCount(3);
    await expect(rows).toHaveText([
      /今天最近会话/,
      /今天较早会话/,
      /昨天会话/,
    ]);

    await activityView.getByText("今天较早会话", { exact: true }).click();
    await expect(rows).toHaveText([
      /今天最近会话/,
      /今天较早会话/,
      /昨天会话/,
    ]);
    await expect(
      activityView.locator('[data-session-id="activity-today-older"]'),
    ).toHaveAttribute("aria-current", "page");

    const sidebarPanel = page.locator("aside").first();
    const sidebarShell = sidebarPanel.locator("..");
    const expandedPanelWidth = await sidebarPanel.evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    );
    await page.getByRole("button", { name: "折叠侧边栏" }).click();
    await expect(page.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
    await expect
      .poll(() =>
        sidebarShell.evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
      )
      .toBe(72);
    await expect
      .poll(() =>
        sidebarPanel.evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
      )
      .toBe(expandedPanelWidth);

    await page.getByRole("button", { name: "展开侧边栏" }).click();
    await expect(page.getByRole("button", { name: "折叠侧边栏" })).toBeVisible();
    await expect
      .poll(() =>
        sidebarShell.evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
      )
      .toBe(expandedPanelWidth);

    await page.reload();
    await expect(page.getByTestId("activity-view")).toBeVisible();
    await page.keyboard.press("Alt+Meta+U");
    await expect(page.getByTestId("activity-view")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "查看活动" })).toBeVisible();
  },
);
