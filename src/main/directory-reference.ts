import path from "node:path";
import type { SessionMeta, WorkspaceMeta } from "../shared/zora";
import type { DirectoryReference } from "../shared/directory-reference";

export function pathSyntax(value: string): typeof path.posix {
  return /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\") ? path.win32 : path.posix;
}

/** Read a source path using its own platform's syntax. */
export function relativeWithin(root: string, value: string): string | undefined {
  const syntax = pathSyntax(root);
  if (syntax !== pathSyntax(value) || !syntax.isAbsolute(root) || !syntax.isAbsolute(value)) return undefined;
  const relative = syntax.relative(root, value);
  if (relative === ".." || relative.startsWith(`..${syntax.sep}`) || syntax.isAbsolute(relative)) return undefined;
  // A POSIX backslash is a filename character, not a portable directory separator.
  if (syntax === path.posix && relative.includes("\\")) return undefined;
  return relative.split(syntax.sep).join("/");
}

export function resolveRelative(root: string, relative: string): string {
  if (relative.includes("\\") || relative.includes("\0") || relative.split("/").some((part) => part === ".." || part.includes(":")) || path.posix.isAbsolute(relative)) {
    throw new Error("数据中的相对目录超出所属范围");
  }
  return pathSyntax(root).join(root, ...relative.split("/"));
}

export function resolveDirectoryReference(ref: DirectoryReference, dataRoot: string, projectRoot?: string): string | undefined {
  switch (ref.kind) {
    case "data": return resolveRelative(dataRoot, ref.path);
    case "project": return projectRoot ? resolveRelative(projectRoot, ref.path) : undefined;
    case "external": return ref.path;
    case "unbound": return undefined;
    default: throw new Error("无法读取工作目录引用");
  }
}

export function createDirectoryReference(directory: string | undefined, dataRoot: string, projectRoot?: string): DirectoryReference {
  if (!directory) return { kind: "unbound" };
  const project = projectRoot ? relativeWithin(projectRoot, directory) : undefined;
  if (project !== undefined) return { kind: "project", path: project };
  const managed = relativeWithin(dataRoot, directory);
  if (managed !== undefined) return { kind: "data", path: managed };
  return { kind: "external", path: directory };
}

export type StoredSession = Omit<SessionMeta, "workingDirectory" | "directory"> & { directory: DirectoryReference };

export function decodeSession(record: StoredSession, dataRoot: string, projectRoot?: string): SessionMeta {
  if (!record.directory || typeof record.directory.kind !== "string") throw new Error("会话目录格式需要升级");
  return { ...record, workingDirectory: resolveDirectoryReference(record.directory, dataRoot, projectRoot) };
}

export function encodeSession(session: SessionMeta, dataRoot: string, projectRoot?: string): StoredSession {
  const { workingDirectory, directory: existing, ...record } = session;
  const directory = existing && resolveDirectoryReference(existing, dataRoot, projectRoot) === workingDirectory
    ? existing : createDirectoryReference(workingDirectory, dataRoot, projectRoot);
  return { ...record, directory };
}

export function encodeWorkspace(workspace: WorkspaceMeta): Omit<WorkspaceMeta, "path"> & { path?: string } {
  const { path: directory, ...record } = workspace;
  return workspace.id === "default" ? record : { ...record, path: directory };
}

export function decodeWorkspace(value: unknown, dataRoot: string): unknown {
  if (typeof value === "object" && value !== null && "id" in value && value.id === "default") {
    return { ...value, path: path.join(dataRoot, "workspaces", "default", "files") };
  }
  return value;
}
