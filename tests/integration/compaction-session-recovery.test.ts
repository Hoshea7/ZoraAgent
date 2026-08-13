import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("compaction session recovery", () => {
  const tempHomes = new Set<string>();

  afterEach(() => {
    vi.doUnmock("node:os");
    vi.resetModules();
    for (const home of tempHomes) {
      rmSync(home, { recursive: true, force: true });
    }
    tempHomes.clear();
  });

  it("recovers product UI state without replacing the Pi checkpoint", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "zora-compaction-recovery-"));
    tempHomes.add(home);
    const workspaceId = "recovery-workspace";
    const sessionId = "recovery-session";
    const sessionsDirectory = path.join(
      home,
      ".zora",
      "workspaces",
      workspaceId,
      "sessions",
    );
    const checkpointDirectory = path.join(
      sessionsDirectory,
      "runtime",
      "pi",
      sessionId,
    );
    mkdirSync(checkpointDirectory, { recursive: true });

    writeFileSync(
      path.join(sessionsDirectory, "index.json"),
      JSON.stringify([
        {
          id: sessionId,
          title: "Recovery session",
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:01:00.000Z",
          workingDirectory: home,
          permissionMode: "ask",
          agentRuntimeType: "pi",
          contextWindowState: {
            usedTokens: 42_000,
            contextWindow: 100_000,
            thresholdTokens: 80_000,
            status: "compacting",
            compactionCount: 2,
            updatedAt: "2026-08-13T00:01:00.000Z",
          },
        },
      ]),
    );
    const checkpointPath = path.join(checkpointDirectory, "checkpoint.jsonl");
    const checkpoint = [
      JSON.stringify({ type: "session", id: sessionId }),
      JSON.stringify({
        type: "compaction",
        id: "compaction-boundary-1",
        summary: "Persistent summary",
        firstKeptEntryId: "message-2",
      }),
      "",
    ].join("\n");
    writeFileSync(checkpointPath, checkpoint);

    vi.resetModules();
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      return { ...actual, homedir: () => home };
    });
    const { listSessions } = await import("@/main/session-store");

    await expect(listSessions(workspaceId)).resolves.toEqual([
      expect.objectContaining({
        id: sessionId,
        contextWindowState: expect.objectContaining({
          status: "ready",
          usedTokens: 42_000,
          compactionCount: 2,
        }),
      }),
    ]);
    expect(readFileSync(checkpointPath, "utf8")).toBe(checkpoint);
  });
});
