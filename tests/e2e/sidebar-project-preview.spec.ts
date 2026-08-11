import { expect, test } from "./support/electron-fixture";

const PROJECT_ID = "sidebar-preview-project";
const NOW = "2026-08-11T04:00:00.000Z";
const recentParent = {
  id: "recent-parent",
  title: "最近父会话",
  createdAt: NOW,
  updatedAt: NOW,
  permissionMode: "ask" as const,
};
const recentChildren = Array.from({ length: 4 }, (_, index) => ({
  id: `recent-child-${index}`,
  title: `最近子任务 ${index}`,
  createdAt: NOW,
  updatedAt: `2026-08-11T04:0${index + 1}:00.000Z`,
  permissionMode: "ask" as const,
  parentSessionId: recentParent.id,
  rootSessionId: recentParent.id,
  delegationDepth: 1,
  delegationRole: "explore" as const,
  delegationStatus: "completed" as const,
}));
const olderParents = Array.from({ length: 4 }, (_, index) => ({
  id: `older-parent-${index}`,
  title: `较早父会话 ${index}`,
  createdAt: NOW,
  updatedAt: `2026-08-11T03:0${3 - index}:00.000Z`,
  permissionMode: "ask" as const,
}));

test.use({
  workspaceSeed: {
    id: PROJECT_ID,
    name: "预览测试项目",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [...recentChildren, recentParent, ...olderParents],
  },
});

test("项目折叠预览显示最近四个顶层会话", async ({ page }) => {
  await page
    .getByRole("button", { name: "预览测试项目", exact: true })
    .click();

  await expect(page.getByText("最近父会话")).toBeVisible();
  await expect(page.getByText("较早父会话 0")).toBeVisible();
  await expect(page.getByText("较早父会话 1")).toBeVisible();
  await expect(page.getByText("较早父会话 2")).toBeVisible();
  await expect(page.getByText("较早父会话 3")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "展开全部" })).toBeVisible();
});
