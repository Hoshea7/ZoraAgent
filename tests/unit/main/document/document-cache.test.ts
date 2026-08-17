import { DocumentSnapshotCache } from "@/main/document/document-cache";
import type { ParsedDocumentSnapshot } from "@/main/document/document-types";

function snapshot(name: string, estimatedBytes: number): ParsedDocumentSnapshot {
  return {
    format: "docx",
    metadata: {},
    blocks: [{ kind: "block", markdown: name }],
    warnings: [],
    estimatedBytes,
  };
}

describe("DocumentSnapshotCache", () => {
  it("evicts the least recently used snapshot within the byte budget", () => {
    const cache = new DocumentSnapshotCache();
    cache.set("first", snapshot("first", 40), 100);
    cache.set("second", snapshot("second", 40), 100);
    expect(cache.get("first")?.blocks[0].markdown).toBe("first");
    cache.set("third", snapshot("third", 40), 100);
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBeDefined();
    expect(cache.get("third")).toBeDefined();
    expect(cache.sizeBytes).toBe(80);
  });

  it("does not cache a snapshot larger than the full budget", () => {
    const cache = new DocumentSnapshotCache();
    cache.set("large", snapshot("large", 101), 100);
    expect(cache.size).toBe(0);
  });
});
