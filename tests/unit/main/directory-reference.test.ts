import { createDirectoryReference, resolveDirectoryReference, relativeWithin, resolveRelative, encodeSession, decodeSession } from "@/main/directory-reference";
import { sourceDataRoot, upgradeSessionDirectory } from "@/main/data-format";
import type { SessionMeta } from "@/shared/zora";
const session = { id: "s1", title: "old", createdAt: "t", updatedAt: "t", permissionMode: "ask" } as SessionMeta;

it.each([
  ["/Users/old/project", "/Users/old/project/src/docs", "src/docs"],
  [String.raw`D:\Work\project`, String.raw`D:\Work\project\src\docs`, "src/docs"],
  [String.raw`\\server\share\project`, String.raw`\\server\share\project\src`, "src"],
  ["/project", "/project-neighbor", undefined],
  [String.raw`C:\project`, String.raw`D:\project\src`, undefined],
  ["/project", String.raw`C:\project\src`, undefined],
])("interprets source-platform containment %s → %s", (root, directory, expected) => {
  expect(relativeWithin(root, directory)).toBe(expected);
});

it.each(["../other", "a/../../other", "/absolute", "C:/external", String.raw`a\..\b`, "a\0b"])("rejects escaping relative references %s", (relative) => {
  expect(() => resolveRelative("/new/.zora", relative)).toThrow();
});

it("moves managed resources and project children by changing only their roots", () => {
  const data = createDirectoryReference("/old/.zora/workspaces/default/files/s1", "/old/.zora");
  expect(data).toEqual({ kind: "data", path: "workspaces/default/files/s1" });
  expect(resolveDirectoryReference(data, "/new/.zora")).toBe("/new/.zora/workspaces/default/files/s1");
  const project = createDirectoryReference(String.raw`D:\project\docs`, String.raw`C:\Users\old\.zora`, String.raw`D:\project`);
  expect(project).toEqual({ kind: "project", path: "docs" });
  expect(resolveDirectoryReference(project, "/new/.zora", "/new/project")).toBe("/new/project/docs");
  expect(resolveDirectoryReference(data, String.raw`C:\Users\new\.zora`)).toBe(String.raw`C:\Users\new\.zora\workspaces\default\files\s1`);
});

it("persists only the reference while projecting an absolute runtime directory", () => {
  const stored = encodeSession({ ...session, workingDirectory: "/project/nested" }, "/data", "/project");
  expect(stored).not.toHaveProperty("workingDirectory");
  expect(stored.directory).toEqual({ kind: "project", path: "nested" });
  const moved = decodeSession(stored, "/new-data", "/new-project");
  expect(moved.workingDirectory).toBe("/new-project/nested");
  expect(encodeSession(moved, "/new-data", "/new-project")).toEqual(stored);
  expect(encodeSession({ ...moved, workingDirectory: "/external" }, "/new-data", "/new-project").directory).toEqual({ kind: "external", path: "/external" });
});

it("preserves source home semantics and leaves unknown legacy directories unbound", () => {
  const root = sourceDataRoot(String.raw`C:\Users\old\.zora\workspaces\default\files`);
  expect(root).toBe(String.raw`C:\Users\old\.zora`);
  expect(upgradeSessionDirectory(session, "default", undefined, root)).toEqual({ kind: "external", path: String.raw`C:\Users\old` });
  expect(upgradeSessionDirectory(session, "default", undefined, undefined)).toEqual({ kind: "unbound" });
  expect(upgradeSessionDirectory({ ...session, workingDirectory: "/outside" }, "p1", "/project", "/old/.zora")).toEqual({ kind: "external", path: "/outside" });
  expect(sourceDataRoot("/home/other/files")).toBeUndefined();
});

it("recognizes an owned legacy directory by layout and owner identity even after the default root was refreshed", () => {
  const old = { ...session, workingDirectory: "/old/.zora/workspaces/default/files/s1" };
  expect(upgradeSessionDirectory(old, "default", undefined, "/new/.zora")).toEqual({ kind: "data", path: "workspaces/default/files/s1" });
  expect(upgradeSessionDirectory({ ...old, id: "other" }, "default", undefined, "/new/.zora")).toEqual({ kind: "external", path: old.workingDirectory });
});
