import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let home: string;
afterEach(() => {
  vi.doUnmock("node:os");
  vi.resetModules();
  if (home) rmSync(home, { recursive: true, force: true });
});

it.each([true, false])("restores a failed tool when its result precedes the snapshot: %s", async (resultFirst) => {
  home = mkdtempSync(path.join(tmpdir(), "zora-tool-results-"));
  vi.resetModules();
  vi.doMock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), homedir: () => home }));
  const directory = path.join(home, ".zora", "workspaces", "default", "sessions");
  mkdirSync(directory, { recursive: true });
  const snapshot = { kind: "assistant_turn", turn: {
    id: "turn", status: "done", startedAt: 1, completedAt: 3, bodySegments: [],
    processSteps: [{ type: "tool", tool: { id: "read-call", name: "Read", input: "{}", status: "running", startedAt: 1 } }],
  } };
  const result = { kind: "tool_result", toolUseId: "read-call", result: "该项目文件夹已被删除或移动", isError: true, completedAt: 2 };
  writeFileSync(path.join(directory, "session.jsonl"), (resultFirst ? [result, snapshot] : [snapshot, result]).map((item) => JSON.stringify(item)).join("\n"));
  const { loadMessages } = await import("@/main/session-store");
  const messages = await loadMessages("session");
  expect(messages[0]?.turn?.processSteps[0]).toMatchObject({ type: "tool", tool: { status: "error", result: result.result, completedAt: 2 } });
});
