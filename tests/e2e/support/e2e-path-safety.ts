import path from "node:path";

export function assertE2EWritePath(
  runDirectory: string,
  targetPath: string
): void {
  const resolvedRunDirectory = path.resolve(runDirectory);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRunDirectory, resolvedTargetPath);
  const isOutsideRunDirectory =
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);

  if (isOutsideRunDirectory) {
    throw new Error(
      `E2E 写入路径超出本次运行目录：${resolvedTargetPath}`
    );
  }
}
