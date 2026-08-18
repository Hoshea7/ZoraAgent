import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileAttachment } from "../shared/zora";
import { makeImageThumbnail, THUMBNAIL_SUFFIX } from "./attachments/image-thumbnail";
import { isEnoentError, replaceFileAtomically, ZORA_DIR } from "./utils/fs";

export interface PersistedAttachmentRecord {
  attachmentId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
  category: "image" | "document" | "text";
}

export interface ResolvedAttachment {
  record: PersistedAttachmentRecord;
  filePath: string;
}

type SessionDirectoryResolver = (
  root: string,
  workspaceId: string,
  sessionId: string
) => string;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPersistedAttachmentRecord(
  entry: unknown
): entry is PersistedAttachmentRecord {
  if (typeof entry !== "object" || entry === null) return false;
  const record = entry as Record<string, unknown>;
  return (
    typeof record.attachmentId === "string" &&
    UUID_PATTERN.test(record.attachmentId) &&
    typeof record.storageKey === "string" &&
    UUID_PATTERN.test(record.storageKey) &&
    typeof record.filename === "string" &&
    path.basename(record.filename) === record.filename &&
    typeof record.mimeType === "string" &&
    typeof record.size === "number" &&
    (record.category === "image" ||
      record.category === "document" ||
      record.category === "text")
  );
}

function parseManifest(value: unknown): PersistedAttachmentRecord[] {
  if (!Array.isArray(value) || !value.every(isPersistedAttachmentRecord)) {
    throw new Error("Invalid attachment manifest.");
  }
  return value;
}

export class AttachmentResourceModule {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly root: string,
    private readonly resolveSessionDirectory: SessionDirectoryResolver = (
      base,
      workspaceId,
      sessionId
    ) => path.join(base, workspaceId, sessionId)
  ) {}

  async save(
    workspaceId: string,
    sessionId: string,
    attachments: readonly FileAttachment[]
  ): Promise<PersistedAttachmentRecord[]> {
    if (attachments.length === 0) return [];
    return this.runExclusive(workspaceId, sessionId, async () => {
      const sessionDirectory = this.sessionDirectory(workspaceId, sessionId);
      const filesDirectory = path.join(sessionDirectory, "files");
      await mkdir(filesDirectory, { recursive: true });
      const manifest = await this.readManifest(workspaceId, sessionId);
      const saved: PersistedAttachmentRecord[] = [];

      for (const attachment of attachments) {
        const attachmentId = randomUUID();
        const storageKey = randomUUID();
        const filename = path.basename(attachment.name) || "attachment";
        const destinationPath = path.join(filesDirectory, storageKey);
        if (attachment.localPath) {
          await copyFile(attachment.localPath, destinationPath);
        } else if (attachment.rawBase64) {
          await writeFile(destinationPath, Buffer.from(attachment.rawBase64, "base64"));
        } else {
          continue;
        }
        if (attachment.category === "image") {
          await writeFile(
            path.join(filesDirectory, `${storageKey}${THUMBNAIL_SUFFIX}`),
            Buffer.from(await makeImageThumbnail(destinationPath), "base64")
          );
        }
        saved.push({
          attachmentId,
          storageKey,
          filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          category: attachment.category,
        });
      }

      await this.writeManifest(workspaceId, sessionId, [...manifest, ...saved]);
      return saved;
    });
  }

  async list(
    workspaceId: string,
    sessionId: string
  ): Promise<PersistedAttachmentRecord[]> {
    return this.readManifest(workspaceId, sessionId);
  }

  async resolve(
    workspaceId: string,
    sessionId: string,
    attachmentId: string
  ): Promise<ResolvedAttachment> {
    if (!UUID_PATTERN.test(attachmentId)) throw new Error("ATTACHMENT_NOT_FOUND");
    const record = (await this.readManifest(workspaceId, sessionId)).find(
      (entry) => entry.attachmentId === attachmentId
    );
    if (!record) throw new Error("ATTACHMENT_NOT_FOUND");
    return {
      record,
      filePath: path.join(
        this.sessionDirectory(workspaceId, sessionId),
        "files",
        record.storageKey
      ),
    };
  }

  async ownsPath(
    workspaceId: string,
    sessionId: string,
    candidatePath: string
  ): Promise<boolean> {
    return (await this.findByPath(workspaceId, sessionId, candidatePath)) !== null;
  }

  async findByPath(
    workspaceId: string,
    sessionId: string,
    candidatePath: string
  ): Promise<PersistedAttachmentRecord | null> {
    const normalizedCandidate = path.resolve(candidatePath);
    const records = await this.readManifest(workspaceId, sessionId);
    return records.find((record) =>
      path.resolve(
        this.sessionDirectory(workspaceId, sessionId),
        "files",
        record.storageKey
      ) === normalizedCandidate
    ) ?? null;
  }

  async fork(
    workspaceId: string,
    sourceSessionId: string,
    targetSessionId: string,
    attachmentIds?: ReadonlySet<string>
  ): Promise<void> {
    const sourceRecords = await this.readManifest(workspaceId, sourceSessionId);
    const records = attachmentIds
      ? sourceRecords.filter((record) => attachmentIds.has(record.attachmentId))
      : sourceRecords;
    if (records.length === 0) return;
    const targetFiles = path.join(
      this.sessionDirectory(workspaceId, targetSessionId),
      "files"
    );
    await mkdir(targetFiles, { recursive: true });
    await Promise.all(
      records.flatMap((record) => {
        const sourceDirectory = this.sessionDirectory(workspaceId, sourceSessionId);
        const files = [record.storageKey, `${record.storageKey}${THUMBNAIL_SUFFIX}`];
        return files.map((file) =>
          copyFile(
            path.join(sourceDirectory, "files", file),
            path.join(targetFiles, file)
          ).catch((error) => {
            if (!isEnoentError(error) || file === record.storageKey) throw error;
          })
        );
      })
    );
    await this.writeManifest(workspaceId, targetSessionId, records);
  }

  async retain(
    workspaceId: string,
    sessionId: string,
    attachmentIds: ReadonlySet<string>
  ): Promise<void> {
    await this.runExclusive(workspaceId, sessionId, async () => {
      const records = await this.readManifest(workspaceId, sessionId);
      const retained = records.filter((record) => attachmentIds.has(record.attachmentId));
      await this.writeManifest(workspaceId, sessionId, retained);

      const filesDirectory = path.join(
        this.sessionDirectory(workspaceId, sessionId),
        "files"
      );
      let storedFiles: string[];
      try {
        storedFiles = await readdir(filesDirectory);
      } catch (error) {
        if (isEnoentError(error)) {
          return;
        }
        console.error(
          "[attachment-resource] Failed to scan orphan attachments:",
          error
        );
        return;
      }

      const retainedStorageKeys = new Set(retained.map((record) => record.storageKey));
      const cleanupResults = await Promise.allSettled(
        storedFiles
          .map((fileName) => {
            const storageKey = fileName.endsWith(THUMBNAIL_SUFFIX)
              ? fileName.slice(0, -THUMBNAIL_SUFFIX.length)
              : fileName;
            return { fileName, storageKey };
          })
          .filter(
            ({ storageKey }) =>
              UUID_PATTERN.test(storageKey) && !retainedStorageKeys.has(storageKey)
          )
          .map(({ fileName }) =>
            rm(path.join(filesDirectory, fileName), { force: true })
          )
      );
      for (const result of cleanupResults) {
        if (result.status === "rejected") {
          console.error("[attachment-resource] Failed to delete an orphan attachment:", result.reason);
        }
      }
    });
  }

  private sessionDirectory(workspaceId: string, sessionId: string): string {
    return this.resolveSessionDirectory(this.root, workspaceId, sessionId);
  }

  private async readManifest(
    workspaceId: string,
    sessionId: string
  ): Promise<PersistedAttachmentRecord[]> {
    let content: string;
    try {
      content = await readFile(
        path.join(this.sessionDirectory(workspaceId, sessionId), "manifest.json"),
        "utf8"
      );
    } catch (error) {
      if (isEnoentError(error)) {
        return [];
      }
      throw error;
    }
    return parseManifest(JSON.parse(content));
  }

  private async writeManifest(
    workspaceId: string,
    sessionId: string,
    records: readonly PersistedAttachmentRecord[]
  ): Promise<void> {
    const sessionDirectory = this.sessionDirectory(workspaceId, sessionId);
    await mkdir(sessionDirectory, { recursive: true });
    await replaceFileAtomically(
      path.join(sessionDirectory, "manifest.json"),
      `${JSON.stringify(records, null, 2)}\n`
    );
  }

  private async runExclusive<T>(
    workspaceId: string,
    sessionId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const key = `${workspaceId}\0${sessionId}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.queues.set(key, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(key) === current) {
        this.queues.delete(key);
      }
    }
  }
}

export const attachmentResourceModule = new AttachmentResourceModule(
  path.join(ZORA_DIR, "workspaces"),
  (root, workspaceId, sessionId) =>
    path.join(root, workspaceId, "sessions", "attachments", sessionId)
);
