import type { ParsedDocumentSnapshot } from "./document-types";

export class DocumentSnapshotCache {
  private readonly entries = new Map<string, ParsedDocumentSnapshot>();
  private totalBytes = 0;

  get(key: string): ParsedDocumentSnapshot | undefined {
    const snapshot = this.entries.get(key);
    if (!snapshot) return undefined;
    this.entries.delete(key);
    this.entries.set(key, snapshot);
    return snapshot;
  }

  set(
    key: string,
    snapshot: ParsedDocumentSnapshot,
    maxBytes: number
  ): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.totalBytes -= previous.estimatedBytes;
    }
    if (snapshot.estimatedBytes > maxBytes) return;
    while (
      this.totalBytes + snapshot.estimatedBytes > maxBytes &&
      this.entries.size > 0
    ) {
      const oldestKey = this.entries.keys().next().value as string;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest?.estimatedBytes ?? 0;
    }
    this.entries.set(key, snapshot);
    this.totalBytes += snapshot.estimatedBytes;
  }

  get sizeBytes(): number {
    return this.totalBytes;
  }

  get size(): number {
    return this.entries.size;
  }
}
