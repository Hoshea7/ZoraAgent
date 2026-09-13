import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  test, expect, E2E_COVERAGE, setNextOpenDialogPath,
  restartElectronApplication, loadRealProviders, sendMessage,
  expectAssistantTextUntilSettled,
} from "./support/electron-fixture";
import { assertE2EWritePath } from "./support/e2e-path-safety";
import type { ElectronApplication, Page } from "@playwright/test";

const workspaceId = "directory-binding-project";
const projectName = "目录关联验收";
const sessionId = "4e8d7ff4-85ae-4e25-a90a-6d6d60a4c7ae";
const timestamp = "2026-09-12T00:00:00.000Z";
const unavailable = "该项目文件夹已被删除或移动";
function seed(runtime: "pi" | "claude" = "pi", withHistory = true) {
  return {
    id: workspaceId, name: projectName, createdAt: timestamp, updatedAt: timestamp,
    sessions: [{ id: sessionId, title: "继续原来的工作", createdAt: timestamp, updatedAt: timestamp, agentRuntimeType: runtime, permissionMode: "yolo" as const }],
    sessionMessages: { [sessionId]: withHistory ? [
      { id: "old-user", role: "user" as const, text: "请记住这个项目的代号是 ALPHA-742。", timestamp: 1 },
      { id: "old-assistant", role: "assistant" as const, text: "项目代号 ALPHA-742，后续继续使用。", timestamp: 2 },
    ] : [] },
  };
}
async function paths(app: ElectronApplication) {
  const data = await app.evaluate(() => process.env.ZORA_HOME!);
  const run = path.dirname(path.dirname(data));
  const oldDirectory = path.join(data, "e2e-workspaces", workspaceId);
  const newDirectory = path.join(run, "moved-project");
  for (const file of [oldDirectory, newDirectory]) assertE2EWritePath(run, file);
  return { data, run, oldDirectory, newDirectory };
}
async function openSession(page: Page, withHistory = true) {
  const row = page.locator(`[data-session-id="${sessionId}"]`);
  if (!await row.isVisible()) await page.getByRole("button", { name: projectName, exact: true }).click();
  await row.click();
  if (withHistory) await expect(page.locator(".ai-message-content")).toContainText("ALPHA-742");
}
async function refreshProject(page: Page) {
  await page.getByRole("button", { name: projectName, exact: true }).click();
  await page.getByRole("button", { name: projectName, exact: true }).click();
}
async function relink(page: Page, app: ElectronApplication, directory: string) {
  await setNextOpenDialogPath(app, directory);
  await page.getByRole("button", { name: `打开${projectName}的操作菜单` }).click();
  await page.getByRole("menuitem", { name: "编辑项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑项目" });
  await dialog.getByRole("button", { name: "选择文件夹" }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: `在${projectName}中新建会话` })).toHaveAttribute("aria-disabled", "false");
}

test.describe("项目目录与迁移入口", () => {
  test.use({ workspaceSeed: seed() });

  test("目录移动后保留历史和草稿，关联后刷新文件树且重启仍有效", E2E_COVERAGE.productLocal, async ({ page, electronApp }, testInfo) => {
    test.setTimeout(90_000);
    const { data, run, oldDirectory, newDirectory } = await paths(electronApp);
    await openSession(page);
    const composer = page.getByPlaceholder(/给 Zora 发消息/);
    await composer.fill("这条草稿需要保留");
    await rename(oldDirectory, newDirectory);
    await refreshProject(page);
    const add = page.getByRole("button", { name: `在${projectName}中新建会话` });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await add.hover();
    await expect(page.getByRole("tooltip", { name: unavailable })).toBeVisible();
    await testInfo.attach("unavailable-project", { body: await page.screenshot(), contentType: "image/png" });
    await expect(page.getByRole("button", { name: projectName, exact: true }).getByText(projectName, { exact: true })).toHaveClass(/text-stone-400/);
    await add.focus();
    await expect(page.getByRole("tooltip", { name: unavailable })).toBeVisible();
    await add.press("Enter");
    await expect(composer).toHaveValue("这条草稿需要保留");
    await expect(page.locator(".ai-message-content")).toContainText("ALPHA-742");
    const indexPath = path.join(data, "workspaces", workspaceId, "sessions", "index.json");
    expect(JSON.parse(await readFile(indexPath, "utf8"))).toHaveLength(1);
    // A temporarily unavailable directory becomes usable on the normal refresh path.
    await rename(newDirectory, oldDirectory);
    await refreshProject(page);
    await expect(add).toHaveAttribute("aria-disabled", "false");
    await rename(oldDirectory, newDirectory);
    await refreshProject(page);
    const marker = path.join(newDirectory, "relinked-marker.txt");
    assertE2EWritePath(run, marker);
    await writeFile(marker, "NEW-DIRECTORY");
    await relink(page, electronApp, newDirectory);
    await expect(composer).toHaveValue("这条草稿需要保留");
    await page.getByTitle("文件树", { exact: true }).click();
    await expect(page.getByText("relinked-marker.txt", { exact: true })).toBeVisible();
    const screenshot = path.join(run, "relinked-project.png");
    assertE2EWritePath(run, screenshot);
    await page.screenshot({ path: screenshot });
    expect(JSON.parse(await readFile(indexPath, "utf8"))[0]).toMatchObject({ id: sessionId, directory: { kind: "project", path: "" } });
    const restarted = await restartElectronApplication(electronApp);
    try {
      await openSession(restarted.page);
      await restarted.page.getByTitle("文件树", { exact: true }).click();
      await expect(restarted.page.getByRole("button", { name: `在${projectName}中新建会话` })).toHaveAttribute("aria-disabled", "false");
      await expect(restarted.page.getByText("relinked-marker.txt", { exact: true })).toBeVisible();
    } finally { await restarted.electronApp.close(); }
  });

  test("迁移页面按方向提供提示词和复制反馈", E2E_COVERAGE.productLocal, async ({ page, electronApp }, testInfo) => {
    const { data } = await paths(electronApp);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "数据迁移", exact: true }).click();
    await expect(page.getByText(data, { exact: true })).toBeVisible();
    const directoryRow = page.getByRole("group", { name: "数据目录", exact: true });
    await expect(directoryRow).toContainText(data);
    await expect(directoryRow.getByRole("button", { name: "打开数据文件夹", exact: true })).toHaveText("打开");
    await expect(page.getByRole("button", { name: "打开数据文件夹", exact: true })).toHaveCount(1);
    const screenshot = testInfo.outputPath("migration-settings.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("migration-settings", { path: screenshot, contentType: "image/png" });
    const archiveCard = page.getByRole("region", { name: "打包提示词", exact: true });
    await expect(archiveCard).toContainText("整个文件夹原样打包");
    await archiveCard.getByRole("button", { name: "复制创建压缩包提示词" }).click();
    await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain(data);
    expect(copied).toContain("压缩包保存在该目录之外");
    await page.getByRole("tab", { name: "迁入此设备", exact: true }).click();
    await expect(page.getByRole("tab", { name: "迁入此设备", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(directoryRow).toContainText(data);
    await expect(directoryRow.getByRole("button", { name: "打开数据文件夹", exact: true })).toHaveText("打开");
    await expect(page.getByRole("button", { name: "打开数据文件夹", exact: true })).toHaveCount(1);
    const restoreCard = page.getByRole("region", { name: "恢复提示词", exact: true });
    await expect(restoreCard).toContainText("覆盖前与我确认");
    await restoreCard.getByRole("button", { name: "复制恢复数据提示词" }).click();
    await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
    const restore = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    expect(restore).toContain(data);
    expect(restore).toContain("覆盖前与我确认");
    expect(restore).not.toEqual(copied);
    await expect(restoreCard.getByText(restore, { exact: true })).toBeVisible();
    const restoreScreenshot = testInfo.outputPath("migration-restore-settings.png");
    await page.screenshot({ path: restoreScreenshot });
    await testInfo.attach("migration-restore-settings", { path: restoreScreenshot, contentType: "image/png" });
  });
});

for (const runtime of ["pi", "claude"] as const) {
  test.describe(`${runtime} 重新关联后继续会话`, () => {
    test.use({ workspaceSeed: seed(runtime, false), providerPresetId: "volcengine-coding-plan", providerModels: { models: [{ id: "glm-5.2", enabled: true }] } });
    test("连接测试后在原会话读取新目录并保留历史问题", E2E_COVERAGE.productAgentProvider, async ({ page, electronApp }) => {
      test.setTimeout(300_000);
      const provider = (await loadRealProviders("volcengine-coding-plan"))[0];
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: "模型配置", exact: true }).click();
      await page.getByRole("button", { name: `编辑 ${provider.name}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "编辑模型配置" });
      await dialog.getByRole("button", { name: "测试连接", exact: true }).click();
      await expect(dialog.getByRole("status", { name: /连接成功/ })).toBeVisible({ timeout: 120_000 });
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await page.getByTitle("关闭设置 (Esc)").click();
      await openSession(page, false);
      const { run, oldDirectory, newDirectory } = await paths(electronApp);
      const oldMarker = path.join(oldDirectory, "continuation.txt");
      assertE2EWritePath(run, oldMarker);
      await writeFile(oldMarker, "BEFORE-READ-5819");
      let count = await page.locator("[data-assistant-message='true']").count();
      await sendMessage(page, "我们约定本项目代号为 ALPHA-742，请记住它。请实际读取当前项目目录中的 continuation.txt，回复文件内容和项目代号。不要修改文件。");
      await expectAssistantTextUntilSettled(page, "BEFORE-READ-5819", count, 120_000);
      await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
      await rename(oldDirectory, newDirectory);
      const newMarker = path.join(newDirectory, "continuation.txt");
      assertE2EWritePath(run, newMarker);
      await writeFile(newMarker, "AFTER-READ-9637");
      await refreshProject(page);
      await expect(page.getByRole("button", { name: `在${projectName}中新建会话` })).toHaveAttribute("aria-disabled", "true");
      count = await page.locator("[data-assistant-message='true']").count();
      await sendMessage(page, "请继续回答我们之前约定的项目代号。然后请实际调用 Read 工具尝试读取相对路径 continuation.txt 一次，即使目录当前不可用；若失败就说明原因，不要创建目录、不要重新关联或修改任何文件。");
      await expectAssistantTextUntilSettled(page, "ALPHA-742", count, 120_000);
      await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
      await expect(page.locator(".ai-process-content").last()).toContainText(/read/i);
      await expect(page.locator(".ai-process-content").last()).toContainText(runtime === "claude" ? "Hook PreToolUse:Read denied this tool" : unavailable);
      const unchanged = JSON.parse(await readFile(path.join((await paths(electronApp)).data, "workspaces.json"), "utf8")).find((item: { id: string }) => item.id === workspaceId);
      expect(unchanged.path).toBe(oldDirectory);
      await relink(page, electronApp, newDirectory);
      await expect(page.locator(".ai-process-content").last()).toContainText(runtime === "claude" ? "Hook PreToolUse:Read denied this tool" : unavailable);
      count = await page.locator("[data-assistant-message='true']").count();
      await sendMessage(page, "请再次用工具实际读取当前项目目录中的 continuation.txt，并执行 pwd 核对工作目录。回复现在的文件内容、工具确认的当前工作目录和我们最早约定的项目代号。不要复用上次的文件内容，不要修改文件。");
      await expectAssistantTextUntilSettled(page, "AFTER-READ-9637", count, 120_000);
      const response = page.locator(".ai-message-content").last();
      await expect(response).toContainText("ALPHA-742");
      await expect(response).toContainText(newDirectory);
      await expect(page.locator(".ai-process-content").last()).toContainText(/read/i);
      await expect(page.locator(".ai-process-content").last()).toContainText("pwd");
    });
  });
}

test.describe("项目菜单编辑", () => {
  test.use({ workspaceSeed: seed() });
  test("编辑项目的短路径和长路径均与图标及按钮居中对齐", E2E_COVERAGE.productLocal, async ({ page, electronApp }, testInfo) => {
    const { run, newDirectory } = await paths(electronApp);
    const longDirectory = path.join(newDirectory, "很长的项目文件夹名称".repeat(6));
    assertE2EWritePath(run, longDirectory);
    await mkdir(longDirectory, { recursive: true });
    await page.getByRole("button", { name: `打开${projectName}的操作菜单` }).click();
    await page.getByRole("menuitem", { name: "编辑项目", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑项目" });
    const directory = dialog.getByLabel("本地文件夹");
    for (const selected of [newDirectory, longDirectory]) {
      await setNextOpenDialogPath(electronApp, selected);
      await dialog.getByRole("button", { name: "选择文件夹" }).click();
      await expect(directory).toHaveValue(selected);
      const layout = await directory.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const row = element.parentElement!;
        const icon = row.querySelector("svg")!.getBoundingClientRect();
        const button = row.querySelector("button")!.getBoundingClientRect();
        return {
          height: rect.height,
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
          iconOffset: Math.abs(rect.y + rect.height / 2 - icon.y - icon.height / 2),
          buttonOffset: Math.abs(rect.y + rect.height / 2 - button.y - button.height / 2),
          overlapsButton: rect.right > button.left,
          overflows: row.scrollWidth > row.clientWidth,
        };
      });
      expect(layout.height).toBeLessThanOrEqual(layout.lineHeight + 2);
      expect(layout.iconOffset).toBeLessThanOrEqual(1);
      expect(layout.buttonOffset).toBeLessThanOrEqual(1);
      expect(layout.overlapsButton).toBe(false);
      expect(layout.overflows).toBe(false);
    }
    await testInfo.attach("edit-project-long-path", { body: await dialog.screenshot(), contentType: "image/png" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  });

  test("编辑暂存与保存、打开本地文件夹、移除项目保留本地文件", E2E_COVERAGE.productLocal, async ({ page, electronApp }, testInfo) => {
    test.setTimeout(90_000);
    const { data, run, oldDirectory, newDirectory } = await paths(electronApp);
    await openSession(page);
    await rename(oldDirectory, newDirectory);
    const marker = path.join(newDirectory, "keep-local-file.txt");
    assertE2EWritePath(run, marker);
    await writeFile(marker, "LOCAL-FILES-STAY");
    await refreshProject(page);
    const openMenu = async (name: string) => page.getByRole("button", { name: `打开${name}的操作菜单` }).click();
    await openMenu(projectName);
    await expect(page.getByRole("menuitem", { name: "重新关联目录", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "重命名", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "打开本地文件夹", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "移除项目", exact: true })).toBeVisible();
    await testInfo.attach("project-menu", { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("menuitem", { name: "编辑项目", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "编辑项目" });
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await dialog.getByLabel("项目名称").fill("新项目名称");
    await setNextOpenDialogPath(electronApp, newDirectory);
    await dialog.getByRole("button", { name: "选择文件夹" }).click();
    await expect(dialog.getByLabel("本地文件夹")).toHaveValue(newDirectory);
    await testInfo.attach("edit-project", { body: await page.screenshot(), contentType: "image/png" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    let saved = JSON.parse(await readFile(path.join(data, "workspaces.json"), "utf8")).find((item: { id: string }) => item.id === workspaceId);
    expect(saved).toMatchObject({ name: projectName, path: oldDirectory });
    await openMenu(projectName);
    await page.getByRole("menuitem", { name: "编辑项目", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "编辑项目" });
    await expect(dialog.getByLabel("项目名称")).toHaveValue(projectName);
    await dialog.getByLabel("项目名称").fill("新项目名称");
    await dialog.getByRole("button", { name: "选择文件夹" }).click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新项目名称", exact: true })).toBeVisible();
    saved = JSON.parse(await readFile(path.join(data, "workspaces.json"), "utf8")).find((item: { id: string }) => item.id === workspaceId);
    expect(saved).toMatchObject({ name: "新项目名称", path: newDirectory });
    await expect(page.locator(".ai-message-content")).toContainText("ALPHA-742");
    // Observe the native folder-open boundary without launching Finder during a test.
    await electronApp.evaluate(({ shell }) => {
      shell.openPath = async (directory) => { (globalThis as typeof globalThis & { openedProjectFolder?: string }).openedProjectFolder = directory; return ""; };
    });
    await openMenu("新项目名称");
    await page.getByRole("menuitem", { name: "打开本地文件夹", exact: true }).click();
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { openedProjectFolder?: string }).openedProjectFolder)).toBe(newDirectory);
    let confirmation = "";
    page.once("dialog", async (event) => { confirmation = event.message(); await event.accept(); });
    await openMenu("新项目名称");
    await page.getByRole("menuitem", { name: "移除项目", exact: true }).click();
    await expect(page.getByRole("button", { name: "新项目名称", exact: true })).toHaveCount(0);
    expect(confirmation).toContain("本地文件夹及其中的文件不会删除");
    expect(await readFile(marker, "utf8")).toBe("LOCAL-FILES-STAY");
  });
});
