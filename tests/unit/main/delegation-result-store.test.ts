import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempHomes = new Set<string>();

async function loadStore() {
  const home = mkdtempSync(path.join(tmpdir(), "zora-delegation-result-"));
  tempHomes.add(home);
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home };
  });
  return import("@/main/delegation/result-store");
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.resetModules();
  for (const home of tempHomes) {
    rmSync(home, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("delegation result store", () => {
  it("persists an immutable run-scoped terminal result", async () => {
    const store = await loadStore();
    const record = {
      delegationId: "child-1",
      runId: "run-1",
      status: "completed" as const,
      resultSummary: "RUN_ONE_RESULT",
      resultTruncated: false,
      completedAt: 10,
    };

    await expect(store.putTerminalResult("workspace-1", record)).resolves.toEqual(record);
    await expect(store.putTerminalResult("workspace-1", record)).resolves.toEqual(record);
    await expect(store.getResult("workspace-1", "child-1", "run-1")).resolves.toEqual(
      record
    );
    await expect(
      store.putTerminalResult("workspace-1", {
        ...record,
        resultSummary: "CONFLICTING_RESULT",
      })
    ).rejects.toThrow("Delegation result conflict");
  });

  it("deletes all results for a permanently deleted child session", async () => {
    const store = await loadStore();
    await store.putTerminalResult("workspace-1", {
      delegationId: "child-1",
      runId: "run-1",
      status: "failed",
      resultTruncated: false,
      error: "failed",
      completedAt: 20,
    });

    await store.deleteBySession("workspace-1", "child-1");

    await expect(store.getResult("workspace-1", "child-1", "run-1")).resolves.toBeNull();
  });
});
