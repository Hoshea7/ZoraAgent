import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkspaceMeta } from "@/shared/zora";

const tempHomes = new Set<string>();

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-workspace-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function getZoraPath(homeDir: string, ...segments: string[]) {
  return path.join(homeDir, ".zora", ...segments);
}

async function loadWorkspaceStoreModule(homeDir: string) {
  vi.resetModules();

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  return import("@/main/workspace-store");
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.resetModules();

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("main workspace-store", () => {
  it("creates the default workspace and persists sidecar metadata on first load", async () => {
    const homeDir = createTempHome();
    const { listWorkspaces } = await loadWorkspaceStoreModule(homeDir);

    const workspaces = await listWorkspaces();

    expect(workspaces).toEqual([
      expect.objectContaining({
        id: "default",
        name: "默认工作区",
        path: getZoraPath(homeDir, "workspaces", "default", "files"),
      }),
    ]);
    expect(existsSync(getZoraPath(homeDir, "workspaces.json"))).toBe(true);
    expect(existsSync(getZoraPath(homeDir, "workspaces", "default", "workspace.json"))).toBe(
      true
    );
    expect(existsSync(getZoraPath(homeDir, "workspaces", "default", "files"))).toBe(
      true
    );
  });

  it("handles concurrent workspace listing without sidecar write races", async () => {
    const homeDir = createTempHome();
    const { createWorkspace, listWorkspaces } = await loadWorkspaceStoreModule(homeDir);
    mkdirSync(path.join(homeDir, "project-a"));
    mkdirSync(path.join(homeDir, "project-b"));
    const workspaceA = await createWorkspace("Project A", path.join(homeDir, "project-a"));
    const workspaceB = await createWorkspace("Project B", path.join(homeDir, "project-b"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const results = await Promise.all(
        Array.from({ length: 30 }, () => listWorkspaces())
      );

      expect(results).toHaveLength(30);
      expect(results.every((workspaces) => workspaces.length === 3)).toBe(true);
      expect(
        warnSpy.mock.calls.filter(([message]) =>
          String(message).includes("Failed to persist workspace sidecar")
        )
      ).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }

    for (const workspaceId of ["default", workspaceA.id, workspaceB.id]) {
      expect(
        existsSync(getZoraPath(homeDir, "workspaces", workspaceId, "workspace.json"))
      ).toBe(true);
    }
  });

  it("repairs missing sidecar metadata on a clean workspace list", async () => {
    const homeDir = createTempHome();
    const { createWorkspace, listWorkspaces } = await loadWorkspaceStoreModule(homeDir);
    mkdirSync(path.join(homeDir, "project-a"));
    const workspace = await createWorkspace("Project A", path.join(homeDir, "project-a"));
    const sidecarPath = getZoraPath(
      homeDir,
      "workspaces",
      workspace.id,
      "workspace.json"
    );

    rmSync(sidecarPath, { force: true });
    expect(existsSync(sidecarPath)).toBe(false);

    await listWorkspaces();

    expect(existsSync(sidecarPath)).toBe(true);
    expect(JSON.parse(readFileSync(sidecarPath, "utf8"))).toEqual(workspace);
  });

  it("recovers a workspace from sidecar metadata when the main index is missing", async () => {
    const homeDir = createTempHome();
    const workspace: WorkspaceMeta = {
      id: "workspace-1",
      name: "Recovered Project",
      path: path.join(homeDir, "project"),
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    mkdirSync(getZoraPath(homeDir, "workspaces", workspace.id), { recursive: true });
    writeFileSync(
      getZoraPath(homeDir, "workspaces", workspace.id, "workspace.json"),
      JSON.stringify(workspace),
      "utf8"
    );

    const { listWorkspaces } = await loadWorkspaceStoreModule(homeDir);
    const workspaces = await listWorkspaces();

    expect(workspaces).toEqual([
      expect.objectContaining({ id: "default" }),
      workspace,
    ]);
    const persisted = JSON.parse(readFileSync(getZoraPath(homeDir, "workspaces.json"), "utf8"));
    expect(persisted).toEqual(workspaces.map(({ path: directory, ...record }) => record.id === "default" ? record : { ...record, path: directory }));
  });

  it("backs up a corrupt index and recovers orphan workspaces from session indexes", async () => {
    const homeDir = createTempHome();
    const workspaceId = "orphan-workspace";
    mkdirSync(getZoraPath(homeDir, "workspaces", workspaceId, "sessions"), { recursive: true });
    writeFileSync(getZoraPath(homeDir, "workspaces.json"), "{not-json", "utf8");
    writeFileSync(
      getZoraPath(homeDir, "workspaces", workspaceId, "sessions", "index.json"),
      JSON.stringify([
        {
          id: "old-session",
          title: "Old session",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "latest-session",
          title: "Latest useful session",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        },
      ]),
      "utf8"
    );

    const { listWorkspaces } = await loadWorkspaceStoreModule(homeDir);
    const workspaces = await listWorkspaces();

    expect(workspaces).toEqual([
      expect.objectContaining({ id: "default" }),
      expect.objectContaining({
        id: workspaceId,
        name: "恢复的工作区 orphan-w",
        path: "",
      }),
    ]);
    expect(
      readdirSync(getZoraPath(homeDir)).some((fileName) =>
        fileName.startsWith("workspaces.json.corrupt-")
      )
    ).toBe(true);
    expect(() => JSON.parse(readFileSync(getZoraPath(homeDir, "workspaces.json"), "utf8"))).not.toThrow();
  });
});
