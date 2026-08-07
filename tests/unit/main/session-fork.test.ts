import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempHomes = new Set<string>();
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
type GetClaudeTranscriptPath =
  typeof import("@/main/claude-transcript").getClaudeTranscriptPath;

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-session-fork-"));
  tempHomes.add(homeDir);
  return homeDir;
}

async function writeSdkTranscript(
  getClaudeTranscriptPath: GetClaudeTranscriptPath,
  workingDirectory: string,
  sdkSessionId: string,
  records: Array<Record<string, unknown>>
) {
  const transcriptPath = await getClaudeTranscriptPath({
    sdkSessionId,
    workingDirectory,
  });
  mkdirSync(path.dirname(transcriptPath), { recursive: true });
  writeFileSync(
    transcriptPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
}

async function loadSessionForkRuntime(homeDir: string) {
  vi.resetModules();

  const forkSession = vi.fn();
  process.env.CLAUDE_CONFIG_DIR = path.join(homeDir, ".claude");

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
    forkSession,
  }));

  return {
    claudeTranscriptModule: await import("@/main/claude-transcript"),
    forkSession,
    sessionStoreModule: await import("@/main/session-store"),
    sessionForkModule: await import("@/main/session-fork"),
  };
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.doUnmock("@anthropic-ai/claude-agent-sdk");
  vi.resetModules();

  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  }

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("main session-fork", () => {
  it("translates stale copied assistant turn ids while forking an already forked session", async () => {
    const homeDir = createTempHome();
    const {
      claudeTranscriptModule,
      forkSession,
      sessionForkModule,
      sessionStoreModule,
    } = await loadSessionForkRuntime(homeDir);

    const source = await sessionStoreModule.createSession("Forked source");
    await sessionStoreModule.updateSessionMeta(source.id, {
      agentRuntimeType: "claude",
    });
    await sessionStoreModule.setSdkSessionId(source.id, "sdk-current");
    await sessionStoreModule.appendMessageRecord(source.id, {
      kind: "user",
      message: {
        id: "user-1",
        role: "user",
        text: "Start here.",
        timestamp: 1,
      },
    });
    await sessionStoreModule.appendMessageRecord(source.id, {
      kind: "assistant_turn",
      turn: {
        id: "original-assistant",
        processSteps: [],
        bodySegments: [{ id: "segment-1", text: "Fork from here." }],
        status: "done",
        startedAt: 2,
        completedAt: 2,
      },
    });

    if (!source.workingDirectory) {
      throw new Error("Expected source working directory.");
    }

    await writeSdkTranscript(
      claudeTranscriptModule.getClaudeTranscriptPath,
      source.workingDirectory,
      "sdk-current",
      [
        {
          type: "assistant",
          uuid: "current-assistant",
          sessionId: "sdk-current",
          forkedFrom: {
            sessionId: "sdk-parent",
            messageUuid: "original-assistant",
          },
        },
      ]
    );

    forkSession.mockImplementation(
      async (_sessionId: string, options?: { dir?: string }) => {
        if (!options?.dir) {
          throw new Error("Expected SDK fork dir.");
        }

        await writeSdkTranscript(
          claudeTranscriptModule.getClaudeTranscriptPath,
          options.dir,
          "sdk-next",
          [
            {
              type: "assistant",
              uuid: "next-assistant",
              sessionId: "sdk-next",
              forkedFrom: {
                sessionId: "sdk-current",
                messageUuid: "current-assistant",
              },
            },
          ]
        );

        return { sessionId: "sdk-next" };
      }
    );

    const result = await sessionForkModule.forkSessionFromSource({
      sourceSessionId: source.id,
      workspaceId: "default",
      upToMessageId: "original-assistant",
    });

    expect(forkSession).toHaveBeenCalledWith(
      "sdk-current",
      expect.objectContaining({
        upToMessageId: "current-assistant",
      })
    );

    await expect(sessionStoreModule.loadMessages(source.id)).resolves.toEqual([
      {
        id: "user-1",
        role: "user",
        text: "Start here.",
        timestamp: 1,
      },
      expect.objectContaining({
        turn: expect.objectContaining({
          id: "original-assistant",
        }),
      }),
    ]);
    expect(result.messages).toEqual([
      {
        id: "user-1",
        role: "user",
        text: "Start here.",
        timestamp: 1,
      },
      expect.objectContaining({
        turn: expect.objectContaining({
          id: "next-assistant",
          bodySegments: [{ id: "segment-1", text: "Fork from here." }],
        }),
      }),
    ]);
  });
});
