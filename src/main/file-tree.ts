import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { FileTreeEntry } from "../shared/zora";

const EMPTY_ON_ERROR_CODES = new Set(["ENOENT", "EACCES", "EPERM"]);
const FILE_TREE_CHANGE_CHANNEL = "filetree:changed";
const FILE_TREE_CHANGE_DEBOUNCE_MS = 500;

let currentWatcher: FSWatcher | null = null;
let changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function isPathInsideWorkspace(targetPath: string, workspacePath: string): boolean {
  const relative = path.relative(workspacePath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

async function buildEntry(dirPath: string, name: string, isDirectory: boolean): Promise<FileTreeEntry> {
  const entryPath = path.join(dirPath, name);

  if (isDirectory) {
    return {
      name,
      path: entryPath,
      isDirectory: true,
    };
  }

  const extension = path.extname(name).replace(/^\./, "") || undefined;

  try {
    const stats = await stat(entryPath);
    return {
      name,
      path: entryPath,
      isDirectory: false,
      size: stats.size,
      extension,
    };
  } catch {
    return {
      name,
      path: entryPath,
      isDirectory: false,
      extension,
    };
  }
}

export async function listDirectory(
  dirPath: string,
  workspacePath: string
): Promise<FileTreeEntry[]> {
  const resolvedDirPath = path.resolve(dirPath);
  const resolvedWorkspacePath = path.resolve(workspacePath);

  if (!isPathInsideWorkspace(resolvedDirPath, resolvedWorkspacePath)) {
    throw new Error("The requested directory must be inside the current workspace.");
  }

  try {
    const dirents = await readdir(resolvedDirPath, { withFileTypes: true });
    const entries = await Promise.all(
      dirents.map((dirent) =>
        buildEntry(resolvedDirPath, dirent.name, dirent.isDirectory())
      )
    );

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    if (EMPTY_ON_ERROR_CODES.has(getErrorCode(error) ?? "")) {
      return [];
    }

    throw error;
  }
}

export function stopFileWatcher(): void {
  if (changeDebounceTimer) {
    clearTimeout(changeDebounceTimer);
    changeDebounceTimer = null;
  }

  if (currentWatcher) {
    currentWatcher.close();
    currentWatcher = null;
  }
}

export function startFileWatcher(workspacePath: string, win: BrowserWindow): void {
  stopFileWatcher();

  const resolvedWorkspacePath = path.resolve(workspacePath);

  try {
    currentWatcher = watch(resolvedWorkspacePath, { recursive: true }, () => {
      if (changeDebounceTimer) {
        clearTimeout(changeDebounceTimer);
      }

      changeDebounceTimer = setTimeout(() => {
        changeDebounceTimer = null;

        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          return;
        }

        win.webContents.send(FILE_TREE_CHANGE_CHANNEL);
      }, FILE_TREE_CHANGE_DEBOUNCE_MS);
    });

    currentWatcher.on("error", (error) => {
      console.error("[filetree] File watcher error:", error);
      stopFileWatcher();
    });
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      console.warn(
        `[filetree] Workspace path does not exist, skipping watcher: ${resolvedWorkspacePath}`
      );
      return;
    }

    console.warn("[filetree] Failed to start file watcher:", error);
  }
}
