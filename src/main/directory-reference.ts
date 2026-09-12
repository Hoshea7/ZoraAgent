import path from "node:path";

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
