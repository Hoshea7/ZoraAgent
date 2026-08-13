import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  expectAssistantTextUntilSettled,
  restartElectronApplication,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test.use({ providerContextWindow: 27_000 });

test("手动压缩在上下文过小时提示无需压缩且不创建 Agent Turn", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await selectRuntime(page, "pi");
  await sendMessage(page, "只回复：压缩准入测试完成");
  await expect(page.locator(".ai-message-content").last()).toContainText(
    "压缩准入测试完成",
    { timeout: 60_000 },
  );
  await expect(page.locator('button[title="停止"]')).toBeHidden({
    timeout: 30_000,
  });

  const assistantTurns = await page.locator(".ai-message-content").count();
  const processTurns = await page.locator(".ai-process-content").count();
  const contextBadge = page.getByLabel(/上下文窗口已使用 \d+%/);
  await contextBadge.click();
  await page.getByRole("button", { name: "手动压缩", exact: true }).click();
  await page.getByRole("button", { name: "再次点击确认" }).click();

  const notice = page.getByRole("status").filter({
    hasText: "当前上下文无需压缩",
  });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  expect(await page.locator(".ai-message-content").count()).toBe(
    assistantTurns,
  );
  expect(await page.locator(".ai-process-content").count()).toBe(processTurns);
  await expect(notice).toBeHidden({ timeout: 5_000 });
});

const MANUAL_COMPACTION_SESSION_ID = "manual-compaction-success";
const MANUAL_COMPACTION_WORKSPACE_ID = "manual-compaction-workspace";
const SEEDED_AT = "2026-08-13T00:00:00.000Z";
const RECOVERY_MARKER = "COMPACTION_RESTART_CONTEXT_4286";
const seededConversation = Array.from({ length: 5 }, (_, index) => {
  const timestamp = Date.parse(SEEDED_AT) + index * 2;
  const recoveryFact = index === 0
    ? `必须完整保留的恢复口令是 ${RECOVERY_MARKER}。`
    : "";
  return [
    {
      id: `seed-user-${index}`,
      role: "user" as const,
      text: `第 ${index + 1} 段历史材料。${recoveryFact}${"用于验证手动压缩成功路径的确定性上下文。".repeat(1_600)}`,
      timestamp,
    },
    {
      id: `seed-assistant-${index}`,
      role: "assistant" as const,
      text: `已记录第 ${index + 1} 段历史材料。`,
      timestamp: timestamp + 1,
    },
  ];
}).flat();

interface PiCheckpointEntry {
  id?: string;
  type?: string;
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  fromHook?: boolean;
  usage?: { totalTokens?: number };
}

async function readPiCheckpointEntries(
  zoraHome: string,
): Promise<PiCheckpointEntry[]> {
  const checkpointDirectory = path.join(
    zoraHome,
    "workspaces",
    MANUAL_COMPACTION_WORKSPACE_ID,
    "sessions",
    "runtime",
    "pi",
    MANUAL_COMPACTION_SESSION_ID,
  );

  let checkpointFiles: string[];
  try {
    checkpointFiles = (await readdir(checkpointDirectory)).filter((file) =>
      file.endsWith(".jsonl"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const contents = await Promise.all(
    checkpointFiles.map((file) =>
      readFile(path.join(checkpointDirectory, file), "utf8"),
    ),
  );
  return contents.flatMap((content) =>
    content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PiCheckpointEntry),
  );
}

test.describe("手动压缩成功路径", () => {
  test.use({
    providerContextWindow: 100_000,
    workspaceSeed: {
      id: MANUAL_COMPACTION_WORKSPACE_ID,
      name: "手动压缩测试项目",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
      sessions: [
        {
          id: MANUAL_COMPACTION_SESSION_ID,
          title: "手动压缩成功场景",
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
          permissionMode: "ask",
          agentRuntimeType: "pi",
          contextWindowState: {
            usedTokens: 40_000,
            contextWindow: 100_000,
            thresholdTokens: 80_000,
            status: "ready",
            compactionCount: 0,
            updatedAt: SEEDED_AT,
          },
        },
      ],
      sessionMessages: {
        [MANUAL_COMPACTION_SESSION_ID]: seededConversation,
      },
    },
  });

  test("用户压缩会话并重启 App 后可从同一压缩边界继续对话", async ({
    page,
    electronApp,
  }) => {
    test.setTimeout(120_000);

    await page
      .getByRole("button", { name: "手动压缩测试项目", exact: true })
      .click();
    await page.getByText("手动压缩成功场景", { exact: true }).click();
    await selectRuntime(page, "pi");

    const contextBadge = page.getByLabel(/上下文窗口已使用 \d+%/);
    const beforeLabel = await contextBadge.getAttribute("aria-label");
    const beforePercent = Number(beforeLabel?.match(/(\d+)%/)?.[1]);
    expect(beforePercent).toBeGreaterThan(0);
    const assistantTurnsBefore = await page
      .locator(".ai-message-content")
      .count();
    const processTurnsBefore = await page
      .locator(".ai-process-content")
      .count();

    await contextBadge.click();
    await page.getByRole("button", { name: "手动压缩", exact: true }).click();
    await page.getByRole("button", { name: "再次点击确认" }).click();

    const outcome = page.getByRole("status").filter({
      hasText: /上下文压缩完成|当前上下文无需压缩/,
    });
    await expect(outcome).toContainText("上下文压缩完成", {
      timeout: 45_000,
    });
    const afterLabel = await contextBadge.getAttribute("aria-label");
    const afterPercent = Number(afterLabel?.match(/(\d+)%/)?.[1]);
    expect(afterPercent).toBeLessThan(beforePercent);
    expect(await page.locator(".ai-message-content").count()).toBe(
      assistantTurnsBefore,
    );
    expect(await page.locator(".ai-process-content").count()).toBe(
      processTurnsBefore,
    );

    const zoraHome = await electronApp.evaluate(() => process.env.ZORA_HOME);
    expect(zoraHome).toBeTruthy();
    let checkpointEntries: PiCheckpointEntry[] = [];
    await expect
      .poll(
        async () => {
          checkpointEntries = await readPiCheckpointEntries(zoraHome!);
          return checkpointEntries.filter(
            (entry) => entry.type === "compaction",
          ).length;
        },
        { timeout: 5_000 },
      )
      .toBe(1);

    const compactionEntry = checkpointEntries.find(
      (entry) => entry.type === "compaction",
    );
    expect(compactionEntry).toMatchObject({ fromHook: false });
    expect(compactionEntry?.summary?.trim().length).toBeGreaterThan(0);
    expect(compactionEntry?.tokensBefore).toBeGreaterThan(20_000);
    expect(compactionEntry?.firstKeptEntryId).toBeTruthy();
    expect(compactionEntry?.usage?.totalTokens).toBeGreaterThan(0);
    expect(
      checkpointEntries.some(
        (entry) => entry.id === compactionEntry?.firstKeptEntryId,
      ),
    ).toBe(true);
    const firstMarkerEntryIndex = checkpointEntries.findIndex(
      (entry) =>
        entry.type === "message" &&
        JSON.stringify(entry).includes(RECOVERY_MARKER),
    );
    const firstKeptEntryIndex = checkpointEntries.findIndex(
      (entry) => entry.id === compactionEntry?.firstKeptEntryId,
    );
    expect(firstMarkerEntryIndex).toBeGreaterThanOrEqual(0);
    expect(firstMarkerEntryIndex).toBeLessThan(firstKeptEntryIndex);

    const restarted = await restartElectronApplication(electronApp);
    try {
      await restarted.page
        .getByRole("button", { name: "手动压缩测试项目", exact: true })
        .click();
      await restarted.page
        .getByText("手动压缩成功场景", { exact: true })
        .click();

      const restoredBadge = restarted.page.getByLabel(
        /上下文窗口已使用 \d+%/,
      );
      await expect(restoredBadge).toHaveAttribute(
        "aria-label",
        `上下文窗口已使用 ${afterPercent}%`,
      );

      const restoredAssistantCount = await restarted.page
        .locator(".ai-message-content")
        .count();
      await sendMessage(
        restarted.page,
        "根据这个会话压缩前的历史材料，只回复其中的恢复口令。",
      );
      await expectAssistantTextUntilSettled(
        restarted.page,
        RECOVERY_MARKER,
        restoredAssistantCount,
        60_000,
      );
      await expect(
        restarted.page.getByText(/任务未能完成|请发送“继续”/),
      ).toHaveCount(0);
      await expect(restoredBadge).toBeVisible();

      const resumedEntries = await readPiCheckpointEntries(zoraHome!);
      expect(
        resumedEntries.some(
          (entry) =>
            entry.type === "compaction" && entry.id === compactionEntry?.id,
        ),
      ).toBe(true);
    } finally {
      await restarted.electronApp.close();
    }
  });
});
