import { mkdir, writeFile, readFile, symlink, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { test, expect, E2E_COVERAGE, restartElectronApplication, loadRealProviders, sendMessage, expectAssistantTextUntilSettled, setNextOpenDialogPath, selectRuntime } from "./support/electron-fixture";
import { assertE2EWritePath } from "./support/e2e-path-safety";

const id = "59ac0d00-cf0d-4939-862a-8c024fe0d86d";
const legacyId = "fc21365f-c340-4e27-96a0-726ea9a8d3c7";
const timestamp = "2026-09-12T00:00:00.000Z";
const oldRoot = String.raw`C:\Users\previous\.zora`;
const seed = {
  id: "default", name: "默认工作区", createdAt: timestamp, updatedAt: timestamp,
  sessions: [{ id, title: "换设备继续工作", createdAt: timestamp, updatedAt: timestamp, permissionMode: "yolo" as const, agentRuntimeType: "pi" as const }, { id: legacyId, title: "恢复原工作目录", createdAt: timestamp, updatedAt: timestamp, permissionMode: "yolo" as const, agentRuntimeType: "pi" as const }],
  sessionMessages: { [id]: [
    { id: "old-user", role: "user" as const, text: "请记住我们之前的项目代号是 PORTABLE-517。", timestamp: 1 },
    { id: "old-assistant", role: "assistant" as const, text: "记住了，项目代号是 PORTABLE-517。", timestamp: 2 },
  ] },
  prepareData: async ({ zoraHome, runDirectory }: { zoraHome: string; runDirectory: string }) => {
    const files = path.join(zoraHome, "workspaces", "default", "files", id);
    const skills = path.join(zoraHome, "skills");
    for (const file of [files, skills, path.join(zoraHome, "workspaces.json"), path.join(zoraHome, "workspaces/default/sessions/index.json")]) assertE2EWritePath(runDirectory, file);
    await mkdir(files, { recursive: true });
    await mkdir(skills, { recursive: true });
    await writeFile(path.join(files, "migration-note.txt"), "MOVED-FILE-832");
    await writeFile(path.join(zoraHome, "workspaces.json"), JSON.stringify([{ id: "default", name: "默认工作区", path: `${oldRoot}\\workspaces\\default\\files`, createdAt: timestamp, updatedAt: timestamp }]));
    await writeFile(path.join(zoraHome, "workspaces/default/sessions/index.json"), JSON.stringify([{ ...seed.sessions[0], workingDirectory: `${oldRoot}\\workspaces\\default\\files\\${id}` }, seed.sessions[1]]));
    const missing = path.join(runDirectory, "unavailable-old-skill");
    assertE2EWritePath(runDirectory, missing);
    await symlink(missing, path.join(skills, "pdf"), "dir");
  },
};

test.describe("旧数据迁入新目录", () => {
  test.use({ workspaceSeed: seed });
  test("启动后历史与托管文件可读，断链保留，重启保持升级结果", E2E_COVERAGE.productLocal, async ({ page, electronApp }) => {
    test.setTimeout(90_000);
    await page.locator(`[data-session-id="${id}"]`).click();
    await expect(page.locator(".ai-message-content")).toContainText("PORTABLE-517");
    await page.getByTitle("文件树", { exact: true }).click();
    await expect(page.getByText("migration-note.txt", { exact: true })).toBeVisible();
    const data = await electronApp.evaluate(() => process.env.ZORA_HOME!);
    const index = path.join(data, "workspaces/default/sessions/index.json");
    const upgraded = await readFile(index, "utf8");
    expect(JSON.parse(upgraded)[0]).toMatchObject({ id, directory: { kind: "data", path: `workspaces/default/files/${id}` } });
    expect(JSON.parse(upgraded)[0]).not.toHaveProperty("workingDirectory");
    expect((await lstat(path.join(data, "skills/pdf"))).isSymbolicLink()).toBe(true);
    await page.locator(`[data-session-id="${legacyId}"]`).click();
    await expect(page.getByRole("button", { name: "选择工作目录", exact: true })).toBeVisible();
    await setNextOpenDialogPath(electronApp, path.join(data, "workspaces/default/files", id));
    await page.getByRole("button", { name: "选择工作目录", exact: true }).click();
    await expect(page.getByText("migration-note.txt", { exact: true })).toBeVisible();
    const reboundIndex = await readFile(index, "utf8");
    await page.locator(`[data-session-id="${id}"]`).click();
    const restarted = await restartElectronApplication(electronApp);
    try {
      await restarted.page.locator(`[data-session-id="${id}"]`).click();
      await expect(restarted.page.locator(".ai-message-content")).toContainText("PORTABLE-517");
      await restarted.page.getByTitle("文件树", { exact: true }).click();
      await expect(restarted.page.getByText("migration-note.txt", { exact: true })).toBeVisible();
      expect(await readFile(index, "utf8")).toBe(reboundIndex);
    } finally { await restarted.electronApp.close(); }
  });
});

test.describe("迁入后的 Pi 真实续聊", () => {
  test.use({ providerPresetId: "volcengine-coding-plan", providerModels: { models: [{ id: "glm-5.2", enabled: true }] } });
  test("真实对话迁移数据目录后保留上下文并读取新目录文件", E2E_COVERAGE.productAgentProvider, async ({ page, electronApp }) => {
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
    await selectRuntime(page, "pi");
    const modeButton = page.getByRole("button", { name: /^当前权限模式：/ });
    while (!(await modeButton.getAttribute("aria-label"))?.includes("YOLO")) await modeButton.click();
    await sendMessage(page, "我们约定本次项目代号为 PORTABLE-517。请在当前对话中记住这个代号并简短确认，不要写入文件或记忆，后面我会在此对话继续这个项目。");
    await expectAssistantTextUntilSettled(page, "PORTABLE-517", 0, 120_000);
    await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
    const source = await electronApp.evaluate(() => process.env.ZORA_HOME!);
    const run = path.dirname(path.dirname(source));
    const destination = path.join(run, "new-device", ".zora");
    assertE2EWritePath(run, destination);
    const indexFile = "workspaces/default/sessions/index.json";
    const sessions = JSON.parse(await readFile(path.join(source, indexFile), "utf8"));
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.directory.kind).toBe("data");
    const file = path.join(source, session.directory.path, "migration-note.txt");
    assertE2EWritePath(run, file);
    await writeFile(file, "SOURCE-FILE-241");
    let restarted: Awaited<ReturnType<typeof restartElectronApplication>> | undefined;
    try {
      restarted = await restartElectronApplication(electronApp, destination);
      await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" });
      const newFile = path.join(destination, session.directory.path, "migration-note.txt");
      assertE2EWritePath(run, newFile);
      await writeFile(newFile, "MOVED-FILE-832");
      const restoredPage = restarted.page;
      await restoredPage.locator(`[data-session-id="${session.id}"]`).click();
      await expect(restoredPage.locator(".ai-message-content")).toContainText("PORTABLE-517");
      const count = await restoredPage.locator("[data-assistant-message='true']").count();
      await sendMessage(restoredPage, "请用工具实际读取当前工作目录的 migration-note.txt，并执行 pwd 核对工作目录。回复文件内容、工具确认的当前工作目录和我们之前约定的项目代号。保持文件原样。");
      await expectAssistantTextUntilSettled(restoredPage, "MOVED-FILE-832", count, 120_000);
      const response = restoredPage.locator(".ai-message-content").last();
      await expect(response).toContainText("PORTABLE-517");
      await expect(response).toContainText(path.dirname(newFile));
      await expect(restoredPage.locator(".ai-process-content").last()).toContainText(/read/i);
      await expect(restoredPage.locator(".ai-process-content").last()).toContainText("pwd");
      expect(JSON.parse(await readFile(path.join(destination, indexFile), "utf8"))[0]).toMatchObject({ id: session.id, directory: session.directory });
    } finally {
      try { await restarted?.electronApp.close(); }
      finally { await rm(path.join(destination, "providers.json"), { force: true }); }
    }
  });
});
