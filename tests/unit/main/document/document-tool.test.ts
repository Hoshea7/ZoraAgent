import { createReadDocumentTool } from "@/main/document/document-tool";

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  runtime: "pi" as const,
  runOrigin: "desktop" as const,
  workingDirectory: "/tmp/project",
  mainModel: { providerId: "provider-1", modelId: "model-1" },
  vision: { imageInputCapability: "unknown" as const, visionRelayEnabled: false },
  signal: new AbortController().signal,
};

describe("read_document tool", () => {
  it("maps flat tool input to the document reader", async () => {
    const read = vi.fn().mockResolvedValue({
      status: "ok",
      document: { name: "report.pdf", format: "pdf", sizeBytes: 100, fingerprint: "hash" },
      metadata: { pages: 5 },
      location: { pages: { start: 2, end: 3 } },
      content: "selected pages",
      truncated: false,
      warnings: [],
      safety: { untrustedSource: true },
    });
    const tool = createReadDocumentTool({ read } as never);
    const result = await tool.execute({ path: "report.pdf", pages: "2-3" }, context);
    expect(read).toHaveBeenCalledWith({
      source: { kind: "path", path: "report.pdf" },
      selection: { kind: "pages", start: 2, end: 3 },
    }, expect.objectContaining({ workingDirectory: "/tmp/project" }));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}")).toMatchObject({
      content: "selected pages",
      safety: { untrustedSource: true },
    });
  });

  it.each([
    {},
    { path: "a.pdf", attachmentId: "4b49ab3c-8c7c-4d89-84f7-743ca6ac14bb" },
    { cursor: "cursor", path: "a.pdf" },
    { path: "a.xlsx", rows: "1-2" },
  ])("rejects invalid source and selection combinations", async (input) => {
    const tool = createReadDocumentTool({ read: vi.fn() } as never);
    const result = await tool.execute(input, context);
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("DOCUMENT_INPUT_INVALID"),
    });
  });
});
