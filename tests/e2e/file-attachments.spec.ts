import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMigrationPrompts } from "../../src/shared/migration-prompts";
import { mkdir, open, readFile, readlink, lstat, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { test, expect, E2E_COVERAGE, selectRuntime, sendMessage, expectAssistantTextUntilSettled, setNextOpenDialogPath } from "./support/electron-fixture";
import { assertE2EWritePath } from "./support/e2e-path-safety";

// Real Provider receives the ZIP exclusively through the product attachment flow.
for (const runtime of ["pi", "claude"] as const) {
  test.describe(`ZIP 附件 ${runtime}`, () => {
    test.use({ providerPresetId: "volcengine-coding-plan", providerModels: { models: [{ id: "glm-5.2", enabled: true }] } });
    test("从附件读取中文路径 ZIP 并解压重新打包", E2E_COVERAGE.productAgentProvider, async ({ page, electronApp }, testInfo) => {
      test.setTimeout(240_000);
      const home = await electronApp.evaluate(() => process.env.ZORA_HOME!);
      const run = path.dirname(path.dirname(home));
      const base = path.join(run, "archive-investigation");
      const source = path.join(base, "旧设备备份.zip");
      const target = path.join(base, "extracted");
      const output = path.join(base, "repacked.zip");
      const member = ".zora/workspaces/default/files/sample/迁移 说明.txt";
      const token = "ARCHIVE-CONTENT-8519";
      for (const file of [base, source, target, output]) assertE2EWritePath(run, file);
      await mkdir(base);
      const original = zipSync({ [member]: strToU8(token), ".zora/data-format.json": strToU8('{"version":1}') });
      await writeFile(source, original);
      await setNextOpenDialogPath(electronApp, source);
      await page.getByRole("button", { name: "添加附件", exact: true }).click();
      await expect(page.getByTitle("旧设备备份.zip", { exact: true })).toBeVisible();
      await selectRuntime(page, runtime);
      const mode = page.getByRole("button", { name: /^当前权限模式：/ });
      while (!(await mode.getAttribute("aria-label"))?.includes("YOLO")) await mode.click();
      await sendMessage(page, `请处理我附上的 ZIP。先检查压缩包内有哪些文件，然后解压到 ${target}，实际读取其中的文本文件，最后把解压出来的 .zora 文件夹完整打包为 ${output}，保留 .zora 这一层目录。请回复文本内容与生成路径。已授权这些操作，无需再次确认。全部新增文件必须在 ${base} 内，原压缩包保留原样。这是一个普通压缩包操作任务，不是恢复当前 Zora，不要修改正在使用的应用数据或其他目录。`);
      await expectAssistantTextUntilSettled(page, token, 0, 180_000);
      await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 60_000 });
      expect(await readFile(path.join(target, member), "utf8")).toBe(token);
      expect(await readFile(source)).toEqual(Buffer.from(original));
      const repacked = unzipSync(await readFile(output));
      expect(strFromU8(repacked[member])).toBe(token);
      expect(strFromU8(repacked[".zora/data-format.json"])).toBe('{"version":1}');
      await expect(page.locator(".ai-process-content").last()).toContainText(/Bash/);
      await testInfo.attach("archive-trace", { body: await page.locator(".ai-process-content").last().innerText(), contentType: "text/plain" });
    });
  });
}


test("较大的本地文件显示引用，移除附件保留原文件", E2E_COVERAGE.productLocal, async ({ page, electronApp }) => {
  const home = await electronApp.evaluate(() => process.env.ZORA_HOME!);
  const run = path.dirname(path.dirname(home));
  const source = path.join(run, "large-backup.zip");
  assertE2EWritePath(run, source);
  const handle = await open(source, "w");
  await handle.truncate(101 * 1024 * 1024);
  await handle.close();
  await setNextOpenDialogPath(electronApp, source);
  await page.getByRole("button", { name: "添加附件", exact: true }).click();
  const card = page.getByTitle("large-backup.zip", { exact: true });
  await expect(card).toContainText("本地引用");
  await card.getByRole("button", { name: "移除附件 large-backup.zip" }).click();
  await expect(card).toHaveCount(0);
  expect((await stat(source)).size).toBe(101 * 1024 * 1024);
});


test.describe("迁出原样打包", () => {
  test.use({ providerPresetId: "volcengine-coding-plan", providerModels: { models: [{ id: "glm-5.2", enabled: true }] } });
  test("简短提示词打包隐藏文件并保留有效链接和断链", E2E_COVERAGE.productAgentProvider, async ({ page, electronApp }) => {
    test.skip(process.platform === "win32", "符号链接存储行为在 macOS/Linux 验证");
    test.setTimeout(240_000);
    const home = await electronApp.evaluate(() => process.env.ZORA_HOME!);
    const run = path.dirname(path.dirname(home));
    const base = path.join(run, "export-case");
    const source = path.join(base, ".zora");
    const output = path.join(base, "zora-export.zip");
    const extracted = path.join(base, "unpacked");
    const external = path.join(base, "external.txt");
    const missing = path.join(base, "missing-skill");
    for (const file of [base, source, output, extracted, external, missing]) assertE2EWritePath(run, file);
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, ".hidden-data"), "HIDDEN-DATA-4927");
    await writeFile(path.join(source, "notes.txt"), "SOURCE-UNCHANGED-5918");
    await writeFile(external, "EXTERNAL-CONTENT-6823");
    await symlink(external, path.join(source, "linked-file"));
    await symlink(missing, path.join(source, "missing-skill"));
    await selectRuntime(page, "pi");
    const mode = page.getByRole("button", { name: /^当前权限模式：/ });
    while (!(await mode.getAttribute("aria-label"))?.includes("YOLO")) await mode.click();
    await sendMessage(page, `${createMigrationPrompts(source).archive}\nZIP 保存为 ${output}，新增文件保存在 ${base} 内。`);
    await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 180_000 });
    await expectAssistantTextUntilSettled(page, "zora-export.zip", 0, 10_000);
    await promisify(execFile)("unzip", ["-q", output, "-d", extracted]);
    const restored = path.join(extracted, ".zora");
    for (const directory of [source, restored]) {
      expect(await readFile(path.join(directory, ".hidden-data"), "utf8")).toBe("HIDDEN-DATA-4927");
      expect(await readFile(path.join(directory, "notes.txt"), "utf8")).toBe("SOURCE-UNCHANGED-5918");
      for (const [name, target] of [["linked-file", external], ["missing-skill", missing]]) {
        expect((await lstat(path.join(directory, name))).isSymbolicLink()).toBe(true);
        expect(await readlink(path.join(directory, name))).toBe(target);
      }
    }
    const contents = unzipSync(await readFile(output));
    expect(Object.keys(contents).filter((name) => !name.endsWith("/")).sort()).toEqual([
      ".zora/.hidden-data", ".zora/linked-file", ".zora/missing-skill", ".zora/notes.txt",
    ]);
    await expect(page.locator(".ai-process-content").last()).toContainText(/Bash/);
  });
});
