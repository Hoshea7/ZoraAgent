import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempHomes = new Set<string>();

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-session-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function getSessionsDir(homeDir: string, workspaceId = "default") {
  return path.join(homeDir, ".zora", "workspaces", workspaceId, "sessions");
}

function getJsonlPath(homeDir: string, sessionId: string, workspaceId = "default") {
  return path.join(getSessionsDir(homeDir, workspaceId), `${sessionId}.jsonl`);
}

function getSessionFilesDir(homeDir: string, sessionId: string, workspaceId = "default") {
  return path.join(
    homeDir,
    ".zora",
    "workspaces",
    workspaceId,
    "files",
    sessionId
  );
}

function getAttachmentPath(
  homeDir: string,
  sessionId: string,
  savedFileName: string,
  workspaceId = "default"
) {
  return path.join(
    getSessionsDir(homeDir, workspaceId),
    "attachments",
    sessionId,
    savedFileName
  );
}

async function loadSessionStoreModule(homeDir: string) {
  vi.resetModules();

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  return import("@/main/session-store");
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("node:os");
  vi.resetModules();

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("main session-store", () => {
  it("lists no sessions for a fresh workspace", async () => {
    const homeDir = createTempHome();
    const { listSessions } = await loadSessionStoreModule(homeDir);

    await expect(listSessions()).resolves.toEqual([]);
    expect(existsSync(getSessionsDir(homeDir))).toBe(true);
  });

  it("creates multiple sessions and returns them in newest-first order", async () => {
    const homeDir = createTempHome();
    vi.useFakeTimers();
    const {
      createSession,
      getSessionMeta,
      listSessions,
      renameSession,
      setSdkSessionId,
      clearSdkSessionId,
    } = await loadSessionStoreModule(homeDir);

    vi.setSystemTime(new Date("2026-04-23T09:00:00+08:00"));
    const first = await createSession("First session");

    vi.setSystemTime(new Date("2026-04-23T09:05:00+08:00"));
    const second = await createSession("Second session");

    await expect(listSessions()).resolves.toEqual([
      expect.objectContaining({ id: second.id, title: "Second session" }),
      expect.objectContaining({ id: first.id, title: "First session" }),
    ]);

    vi.setSystemTime(new Date("2026-04-23T09:10:00+08:00"));
    await renameSession(first.id, "Renamed session");
    await setSdkSessionId(first.id, "sdk-session-1");

    await expect(getSessionMeta(first.id)).resolves.toEqual(
      expect.objectContaining({
        id: first.id,
        title: "Renamed session",
        sdkSessionId: "sdk-session-1",
        createdAt: "2026-04-23T01:00:00.000Z",
        updatedAt: "2026-04-23T01:10:00.000Z",
      })
    );

    await clearSdkSessionId(first.id);
    const cleared = await getSessionMeta(first.id);
    expect(cleared).not.toBeNull();
    expect(cleared).not.toHaveProperty("sdkSessionId");
  });

  it("creates a managed working directory for new default sessions", async () => {
    const homeDir = createTempHome();
    const { createSession, getSessionWorkingDirectory, listSessions } =
      await loadSessionStoreModule(homeDir);

    const session = await createSession("Files session");
    const expectedWorkingDirectory = getSessionFilesDir(homeDir, session.id);

    expect(session.workingDirectory).toBe(expectedWorkingDirectory);
    expect(existsSync(expectedWorkingDirectory)).toBe(true);
    await expect(getSessionWorkingDirectory(session.id)).resolves.toBe(
      expectedWorkingDirectory
    );
    await expect(listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: session.id,
        workingDirectory: expectedWorkingDirectory,
      }),
    ]);
  });

  it("hydrates legacy default sessions to the previous home working directory", async () => {
    const homeDir = createTempHome();
    const sessionsDir = getSessionsDir(homeDir);
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      path.join(sessionsDir, "index.json"),
      JSON.stringify([
        {
          id: "legacy-session",
          title: "Legacy session",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ]),
      "utf8"
    );

    const { getSessionWorkingDirectory, listSessions } =
      await loadSessionStoreModule(homeDir);

    await expect(listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: "legacy-session",
        workingDirectory: homeDir,
      }),
    ]);
    await expect(getSessionWorkingDirectory("legacy-session")).resolves.toBe(
      homeDir
    );
  });

  it("preserves archived sessions when hydrating active legacy sessions", async () => {
    const homeDir = createTempHome();
    const sessionsDir = getSessionsDir(homeDir);
    const indexPath = path.join(sessionsDir, "index.json");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      indexPath,
      JSON.stringify([
        {
          id: "active-legacy",
          title: "Active legacy",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "archived-legacy",
          title: "Archived legacy",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          archivedAt: "2026-05-02T00:00:00.000Z",
        },
      ]),
      "utf8"
    );

    const { listSessions } = await loadSessionStoreModule(homeDir);

    await expect(listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: "active-legacy",
        workingDirectory: homeDir,
      }),
    ]);

    const persisted = JSON.parse(readFileSync(indexPath, "utf8")) as Array<{
      id: string;
      workingDirectory?: string;
    }>;
    expect(persisted.map((session) => session.id)).toEqual([
      "active-legacy",
      "archived-legacy",
    ]);
    expect(persisted).toEqual([
      expect.objectContaining({
        id: "active-legacy",
        workingDirectory: homeDir,
      }),
      expect.objectContaining({
        id: "archived-legacy",
        workingDirectory: homeDir,
      }),
    ]);
  });

  it("preserves sibling sessions when archiving a legacy session", async () => {
    const homeDir = createTempHome();
    const sessionsDir = getSessionsDir(homeDir);
    const indexPath = path.join(sessionsDir, "index.json");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      indexPath,
      JSON.stringify([
        {
          id: "archive-target",
          title: "Archive target",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "sibling",
          title: "Sibling",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ]),
      "utf8"
    );

    const { archiveSession } = await loadSessionStoreModule(homeDir);

    await archiveSession("archive-target");

    const persisted = JSON.parse(readFileSync(indexPath, "utf8")) as Array<{
      id: string;
      archivedAt?: string;
      workingDirectory?: string;
    }>;
    expect(persisted.map((session) => session.id)).toEqual([
      "archive-target",
      "sibling",
    ]);
    expect(persisted).toEqual([
      expect.objectContaining({
        id: "archive-target",
        archivedAt: expect.any(String),
        workingDirectory: homeDir,
      }),
      expect.objectContaining({
        id: "sibling",
        workingDirectory: homeDir,
      }),
    ]);
  });

  it("appends message records as JSONL and restores merged assistant turns with tool results", async () => {
    const homeDir = createTempHome();
    const { appendMessageRecord, createSession, loadMessages } =
      await loadSessionStoreModule(homeDir);

    const session = await createSession("Chat session");

    await appendMessageRecord(session.id, {
      kind: "user",
      message: {
        id: "user-1",
        role: "user",
        text: "Please update the file.",
        timestamp: 1,
      },
    });

    await appendMessageRecord(session.id, {
      kind: "assistant_turn",
      turn: {
        id: "turn-1",
        processSteps: [
          {
            type: "tool",
            tool: {
              id: "tool-1",
              name: "Write",
              input: "{\"file_path\":\"/tmp/demo.txt\"}",
              status: "running",
              startedAt: 2,
            },
          },
        ],
        bodySegments: [
          {
            id: "segment-1",
            text: "Updating it now.",
          },
        ],
        status: "done",
        startedAt: 2,
        completedAt: 2,
      },
    });

    await appendMessageRecord(session.id, {
      kind: "tool_result",
      toolUseId: "tool-1",
      result: "Write completed",
      isError: false,
      completedAt: 3,
    });

    await appendMessageRecord(session.id, {
      kind: "assistant_turn",
      turn: {
        id: "turn-2",
        processSteps: [],
        bodySegments: [
          {
            id: "segment-2",
            text: "Finished.",
          },
        ],
        status: "done",
        startedAt: 4,
        completedAt: 4,
      },
    });

    const jsonlPath = getJsonlPath(homeDir, session.id);
    const jsonlLines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    expect(jsonlLines).toHaveLength(4);
    expect(jsonlLines.every((line) => typeof JSON.parse(line) === "object")).toBe(true);

    await expect(loadMessages(session.id)).resolves.toEqual([
      {
        id: "user-1",
        role: "user",
        text: "Please update the file.",
        timestamp: 1,
      },
      {
        id: "turn-1",
        role: "assistant",
        timestamp: 2,
        turn: {
          id: "turn-2",
          processSteps: [
            {
              type: "tool",
              tool: {
                id: "tool-1",
                name: "Write",
                input: "{\"file_path\":\"/tmp/demo.txt\"}",
                result: "Write completed",
                status: "done",
                startedAt: 2,
                completedAt: 3,
              },
            },
          ],
          bodySegments: [
            {
              id: "segment-1",
              text: "Updating it now.",
            },
            {
              id: "segment-2",
              text: "Finished.",
            },
          ],
          status: "done",
          startedAt: 2,
          completedAt: 4,
        },
      },
    ]);
  });

  it("returns an empty array for missing transcripts", async () => {
    const { loadMessages } = await loadSessionStoreModule(createTempHome());

    await expect(loadMessages("missing-session")).resolves.toEqual([]);
  });

  it("loads large transcripts with 100+ messages in order", async () => {
    const homeDir = createTempHome();
    const { appendMessageRecord, createSession, loadMessages } =
      await loadSessionStoreModule(homeDir);

    const session = await createSession("Large transcript");

    for (let index = 0; index < 120; index += 1) {
      await appendMessageRecord(session.id, {
        kind: "user",
        message: {
          id: `user-${index}`,
          role: "user",
          text: `Message ${index}`,
          timestamp: index,
        },
      });
    }

    const messages = await loadMessages(session.id);

    expect(messages).toHaveLength(120);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        id: "user-0",
        text: "Message 0",
      })
    );
    expect(messages.at(-1)).toEqual(
      expect.objectContaining({
        id: "user-119",
        text: "Message 119",
      })
    );
  }, 30_000);

  it("creates forked sessions with copied transcript and attachments", async () => {
    const homeDir = createTempHome();
    const {
      appendMessageRecord,
      createForkedSession,
      createSession,
      listSessions,
      loadMessages,
      saveAttachments,
      updateSessionMeta,
    } = await loadSessionStoreModule(homeDir);

    const source = await createSession("Source session");
    await updateSessionMeta(source.id, {
      providerId: "parent-provider",
      providerLocked: true,
      selectedModelId: "parent-model",
    });

    const savedAttachments = await saveAttachments(source.id, [
      {
        id: "attachment-1",
        name: "note.png",
        category: "image",
        mimeType: "image/png",
        size: 5,
        localPath: "",
        base64Data: Buffer.from("hello").toString("base64"),
      },
    ]);
    await appendMessageRecord(source.id, {
      kind: "user",
      message: {
        id: "user-with-attachment",
        role: "user",
        text: "Please inspect this.",
        timestamp: 1,
        attachments: savedAttachments,
      },
    });

    const fork = await createForkedSession({
      sourceSessionId: source.id,
      sourceSdkSessionId: "sdk-source",
      sdkSessionId: "sdk-fork",
      title: "Source session 的分支",
    });

    expect(fork).toEqual(
      expect.objectContaining({
        title: "Source session 的分支",
        sdkSessionId: "sdk-fork",
        providerLocked: false,
        branch: expect.objectContaining({
          sourceSessionId: source.id,
          sourceSdkSessionId: "sdk-source",
          forkMode: "full",
          inheritedMessageCount: 1,
        }),
      })
    );
    expect(fork).not.toHaveProperty("providerId");
    expect(fork).not.toHaveProperty("selectedModelId");

    const sessions = await listSessions();
    expect(sessions[0]).toEqual(expect.objectContaining({ id: fork.id }));

    const messages = await loadMessages(fork.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        id: "user-with-attachment",
        role: "user",
        text: "Please inspect this.",
      })
    );
    expect(messages[0].attachments?.[0]).toEqual(
      expect.objectContaining({
        id: "attachment-1",
        name: "note.png",
        localPath: expect.stringContaining(fork.id),
        base64Data: Buffer.from("hello").toString("base64"),
      })
    );
    expect(existsSync(messages[0].attachments?.[0]?.localPath ?? "")).toBe(true);
  });

  it("creates message-level forked sessions with a truncated transcript", async () => {
    const homeDir = createTempHome();
    const { appendMessageRecord, createForkedSession, createSession, loadMessages } =
      await loadSessionStoreModule(homeDir);

    const source = await createSession("Source session");
    await appendMessageRecord(source.id, {
      kind: "user",
      message: {
        id: "user-1",
        role: "user",
        text: "Start here.",
        timestamp: 1,
      },
    });
    await appendMessageRecord(source.id, {
      kind: "assistant_turn",
      turn: {
        id: "assistant-1",
        processSteps: [],
        bodySegments: [{ id: "segment-1", text: "First part." }],
        status: "done",
        startedAt: 2,
        completedAt: 2,
      },
    });
    await appendMessageRecord(source.id, {
      kind: "assistant_turn",
      turn: {
        id: "assistant-2",
        processSteps: [],
        bodySegments: [{ id: "segment-2", text: "Fork from here." }],
        status: "done",
        startedAt: 3,
        completedAt: 3,
      },
    });
    await appendMessageRecord(source.id, {
      kind: "user",
      message: {
        id: "user-after-fork",
        role: "user",
        text: "Do not copy this.",
        timestamp: 4,
      },
    });

    const fork = await createForkedSession({
      sourceSessionId: source.id,
      sourceSdkSessionId: "sdk-source",
      sdkSessionId: "sdk-fork",
      upToMessageId: "assistant-2",
    });

    expect(fork.branch).toEqual(
      expect.objectContaining({
        forkMode: "message",
        forkedFromMessageId: "assistant-2",
        inheritedMessageCount: 2,
      })
    );

    await expect(loadMessages(fork.id)).resolves.toEqual([
      {
        id: "user-1",
        role: "user",
        text: "Start here.",
        timestamp: 1,
      },
      expect.objectContaining({
        id: "assistant-1",
        role: "assistant",
        turn: expect.objectContaining({
          id: "assistant-2",
          bodySegments: [
            { id: "segment-1", text: "First part." },
            { id: "segment-2", text: "Fork from here." },
          ],
        }),
      }),
    ]);
  });

  it("remaps assistant turn ids when copying forked transcripts", async () => {
    const homeDir = createTempHome();
    const { appendMessageRecord, createForkedSession, createSession, loadMessages } =
      await loadSessionStoreModule(homeDir);

    const source = await createSession("Source session");
    await appendMessageRecord(source.id, {
      kind: "user",
      message: {
        id: "user-1",
        role: "user",
        text: "Start here.",
        timestamp: 1,
      },
    });
    await appendMessageRecord(source.id, {
      kind: "assistant_turn",
      turn: {
        id: "source-assistant-1",
        processSteps: [],
        bodySegments: [{ id: "segment-1", text: "First part." }],
        status: "done",
        startedAt: 2,
        completedAt: 2,
      },
    });

    const fork = await createForkedSession({
      sourceSessionId: source.id,
      sourceSdkSessionId: "sdk-source",
      sdkSessionId: "sdk-fork",
      transcriptCopyOptions: {
        assistantTurnIdRewrites: new Map([
          ["source-assistant-1", "fork-assistant-1"],
        ]),
      },
    });

    await expect(loadMessages(fork.id)).resolves.toEqual([
      {
        id: "user-1",
        role: "user",
        text: "Start here.",
        timestamp: 1,
      },
      expect.objectContaining({
        id: "fork-assistant-1",
        role: "assistant",
        turn: expect.objectContaining({
          id: "fork-assistant-1",
          bodySegments: [{ id: "segment-1", text: "First part." }],
        }),
      }),
    ]);
  });

  it("copies only inherited attachments for message-level forks", async () => {
    const homeDir = createTempHome();
    const {
      appendMessageRecord,
      createForkedSession,
      createSession,
      loadMessages,
      saveAttachments,
    } = await loadSessionStoreModule(homeDir);

    const source = await createSession("Source session");
    const inheritedAttachments = await saveAttachments(source.id, [
      {
        id: "before-attachment",
        name: "before.txt",
        category: "text",
        mimeType: "text/plain",
        size: 6,
        localPath: "",
        base64Data: Buffer.from("before").toString("base64"),
      },
    ]);
    const skippedAttachments = await saveAttachments(source.id, [
      {
        id: "after-attachment",
        name: "after.txt",
        category: "text",
        mimeType: "text/plain",
        size: 5,
        localPath: "",
        base64Data: Buffer.from("after").toString("base64"),
      },
    ]);

    await appendMessageRecord(source.id, {
      kind: "user",
      message: {
        id: "user-before",
        role: "user",
        text: "Use this file.",
        timestamp: 1,
        attachments: inheritedAttachments,
      },
    });
    await appendMessageRecord(source.id, {
      kind: "assistant_turn",
      turn: {
        id: "assistant-fork-point",
        processSteps: [],
        bodySegments: [{ id: "segment-1", text: "Fork here." }],
        status: "done",
        startedAt: 2,
        completedAt: 2,
      },
    });
    await appendMessageRecord(source.id, {
      kind: "user",
      message: {
        id: "user-after",
        role: "user",
        text: "Do not copy this file.",
        timestamp: 3,
        attachments: skippedAttachments,
      },
    });

    const fork = await createForkedSession({
      sourceSessionId: source.id,
      sourceSdkSessionId: "sdk-source",
      sdkSessionId: "sdk-fork",
      upToMessageId: "assistant-fork-point",
    });

    const messages = await loadMessages(fork.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].attachments?.[0]).toEqual(
      expect.objectContaining({
        id: "before-attachment",
        localPath: expect.stringContaining(fork.id),
      })
    );
    expect(
      existsSync(
        getAttachmentPath(
          homeDir,
          fork.id,
          inheritedAttachments[0]?.savedFileName ?? ""
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        getAttachmentPath(
          homeDir,
          fork.id,
          skippedAttachments[0]?.savedFileName ?? ""
        )
      )
    ).toBe(false);
  });

  it("rejects fork creation when the source session is missing", async () => {
    const { createForkedSession } = await loadSessionStoreModule(createTempHome());

    await expect(
      createForkedSession({
        sourceSessionId: "missing",
        sourceSdkSessionId: "sdk-source",
        sdkSessionId: "sdk-fork",
      })
    ).rejects.toThrow("Source session missing not found.");
  });

  it("archives and restores sessions without deleting artifacts", async () => {
    const homeDir = createTempHome();
    vi.useFakeTimers();
    const {
      archiveSession,
      createSession,
      listArchivedSessions,
      listSessions,
      restoreSession,
    } = await loadSessionStoreModule(homeDir);

    vi.setSystemTime(new Date("2026-05-17T10:00:00+08:00"));
    const session = await createSession("Archive me");
    const sessionFilesDir = getSessionFilesDir(homeDir, session.id);

    vi.setSystemTime(new Date("2026-05-17T10:05:00+08:00"));
    const archived = await archiveSession(session.id);

    expect(archived).toEqual(
      expect.objectContaining({
        id: session.id,
        archivedAt: "2026-05-17T02:05:00.000Z",
      })
    );
    await expect(listSessions()).resolves.toEqual([]);
    await expect(listArchivedSessions()).resolves.toEqual([
      expect.objectContaining({
        workspaceId: "default",
        workspaceName: "默认工作区",
        session: expect.objectContaining({
          id: session.id,
          title: "Archive me",
          archivedAt: "2026-05-17T02:05:00.000Z",
        }),
      }),
    ]);
    expect(existsSync(sessionFilesDir)).toBe(true);

    vi.setSystemTime(new Date("2026-05-17T10:10:00+08:00"));
    const restored = await restoreSession(session.id);

    expect(restored).toEqual(
      expect.objectContaining({
        id: session.id,
        updatedAt: "2026-05-17T02:10:00.000Z",
      })
    );
    expect(restored).not.toHaveProperty("archivedAt");
    await expect(listSessions()).resolves.toEqual([
      expect.objectContaining({ id: session.id, title: "Archive me" }),
    ]);
    await expect(listArchivedSessions()).resolves.toEqual([]);
    expect(existsSync(sessionFilesDir)).toBe(true);
  });

  it("deletes session metadata and transcript files cleanly", async () => {
    const homeDir = createTempHome();
    const { appendMessageRecord, createSession, deleteSession, listSessions, loadMessages } =
      await loadSessionStoreModule(homeDir);

    const session = await createSession("Delete me");
    await appendMessageRecord(session.id, {
      kind: "user",
      message: {
        id: "user-delete",
        role: "user",
        text: "bye",
        timestamp: 1,
      },
    });

    const jsonlPath = getJsonlPath(homeDir, session.id);
    expect(existsSync(jsonlPath)).toBe(true);

    await deleteSession(session.id);

    await expect(listSessions()).resolves.toEqual([]);
    await expect(loadMessages(session.id)).resolves.toEqual([]);
    expect(existsSync(jsonlPath)).toBe(false);
  });
});
