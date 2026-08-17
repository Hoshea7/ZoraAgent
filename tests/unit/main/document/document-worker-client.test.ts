import { EventEmitter } from "node:events";
import { DocumentWorkerClient } from "@/main/document/document-worker-client";
import { DEFAULT_DOCUMENT_LIMITS } from "@/main/document/document-limits";

class FakeWorker extends EventEmitter {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn(async () => 1);
}

function input(timeout: number, signal = new AbortController().signal) {
  return {
    filePath: "/tmp/report.pdf",
    fileName: "report.pdf",
    format: "pdf" as const,
    fingerprint: "hash",
    limits: { ...DEFAULT_DOCUMENT_LIMITS, parseTimeoutMs: timeout },
    signal,
  };
}

describe("DocumentWorkerClient", () => {
  it("terminates a timed-out worker and recreates it for the next request", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const client = new DocumentWorkerClient("worker.js", factory as never);

    await expect(client.parse(input(5))).rejects.toMatchObject({
      code: "DOCUMENT_PARSE_TIMEOUT",
    });
    expect(first.terminate).toHaveBeenCalledOnce();

    second.postMessage.mockImplementation((request) => {
      queueMicrotask(() => second.emit("message", {
        id: request.id,
        ok: true,
        snapshot: {
          format: "pdf",
          metadata: { pages: 1 },
          blocks: [{ kind: "page", page: 1, markdown: "ok" }],
          warnings: [],
          estimatedBytes: 10,
        },
      }));
    });
    await expect(client.parse(input(100))).resolves.toMatchObject({ format: "pdf" });
    expect(factory).toHaveBeenCalledTimes(2);
    await client.close();
  });

  it("terminates the active worker when parsing is aborted", async () => {
    const worker = new FakeWorker();
    const client = new DocumentWorkerClient("worker.js", () => worker as never);
    const controller = new AbortController();
    const pending = client.parse(input(100, controller.signal));
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "DOCUMENT_ABORTED" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
