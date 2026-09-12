import { relativeWithin, resolveRelative, pathSyntax } from "./directory-reference";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { PROJECT_DIRECTORY_UNAVAILABLE } from "../shared/project-directory";

export async function isDirectoryAvailable(directory: string | undefined): Promise<boolean> {
  if (!directory?.trim() || pathSyntax(directory) !== (process.platform === "win32" ? path.win32 : path.posix)) return false;
  try {
    if (!(await stat(directory)).isDirectory()) return false;
    await access(directory, constants.R_OK | constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function requireDirectory(directory: string | undefined): Promise<string> {
  if (!await isDirectoryAvailable(directory)) throw new Error(PROJECT_DIRECTORY_UNAVAILABLE);
  return directory!;
}

/** Map only the root and its descendants, leaving independent session directories intact. */
export function rebindDirectory(directory: string | undefined, previousRoot: string, nextRoot: string): string | undefined {
  if (!directory) return directory;
  const relative = relativeWithin(previousRoot, directory);
  return relative === undefined ? directory : resolveRelative(nextRoot, relative);
}
