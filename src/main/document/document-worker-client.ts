import path from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { DocumentLimits } from "./document-limits";
import type { ParsedDocumentSnapshot } from "./document-types";
import type {
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from "./document-worker-protocol";
import type { DocumentFormat } from "../../shared/document-formats";
import { DocumentReadError } from "./document-error";

export interface DocumentParseInput {
  filePath: string;
  fileName: string;
  format: DocumentFormat;
  fingerprint: string;
  limits: DocumentLimits;
  signal: AbortSignal;
}

export interface DocumentParser {
  parse(input: DocumentParseInput): Promise<ParsedDocumentSnapshot>;
  close(): Promise<void>;
}

export class DocumentWorkerClient implements DocumentParser {
  private worker?: Worker;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workerPath = path.join(__dirname, "document-worker.js"),
    private readonly workerFactory: (workerPath: string) => Worker = (
      resolvedPath
    ) => new Worker(resolvedPath)
  ) {}

  parse(input: DocumentParseInput): Promise<ParsedDocumentSnapshot> {
    const run = this.queue.catch(() => undefined).then(() => this.run(input));
    this.queue = run;
    return run;
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await worker.terminate();
  }

  private async run(input: DocumentParseInput): Promise<ParsedDocumentSnapshot> {
    if (input.signal.aborted) {
      throw new DocumentReadError("DOCUMENT_ABORTED", input.fileName);
    }
    const worker = this.getWorker();
    const request: DocumentWorkerRequest = {
      id: randomUUID(),
      filePath: input.filePath,
      format: input.format,
      fingerprint: input.fingerprint,
      limits: input.limits,
    };

    return new Promise<ParsedDocumentSnapshot>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal.removeEventListener("abort", onAbort);
        worker.off("message", onMessage);
        worker.off("error", onWorkerError);
        worker.off("exit", onExit);
        callback();
      };
      const resetAndReject = (error: DocumentReadError) => {
        finish(() => {
          this.invalidateWorker(worker);
          reject(error);
        });
      };
      const onAbort = () =>
        resetAndReject(new DocumentReadError("DOCUMENT_ABORTED", input.fileName));
      const onWorkerError = (error: Error) =>
        resetAndReject(
          new DocumentReadError("DOCUMENT_INTERNAL_ERROR", input.fileName, {
            cause: error,
          })
        );
      const onExit = (code: number) => {
        if (code !== 0) {
          resetAndReject(
            new DocumentReadError("DOCUMENT_INTERNAL_ERROR", input.fileName)
          );
        }
      };
      const onMessage = (response: DocumentWorkerResponse) => {
        if (response.id !== request.id) return;
        finish(() => {
          if (response.ok) resolve(response.snapshot);
          else reject(mapWorkerError(response.error, input.fileName));
        });
      };
      const timer = setTimeout(
        () =>
          resetAndReject(
            new DocumentReadError("DOCUMENT_PARSE_TIMEOUT", input.fileName)
          ),
        input.limits.parseTimeoutMs
      );
      input.signal.addEventListener("abort", onAbort, { once: true });
      worker.on("message", onMessage);
      worker.once("error", onWorkerError);
      worker.once("exit", onExit);
      worker.postMessage(request);
    });
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = this.workerFactory(this.workerPath);
    }
    return this.worker;
  }

  private invalidateWorker(worker: Worker): void {
    if (this.worker === worker) this.worker = undefined;
    void worker.terminate();
  }
}

function mapWorkerError(
  error: { code?: string; message: string; name?: string },
  fileName: string
): DocumentReadError {
  if (error.name === "AbortError") {
    return new DocumentReadError("DOCUMENT_ABORTED", fileName);
  }
  const complexityCodes = new Set([
    "DOCUMENT_TOO_COMPLEX",
    "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
    "ZIP_SIZE_LIMIT_EXCEEDED",
    "MAX_NESTING_DEPTH_EXCEEDED",
  ]);
  if (error.code && complexityCodes.has(error.code)) {
    return new DocumentReadError("DOCUMENT_TOO_COMPLEX", fileName);
  }
  if (error.code === "DOCUMENT_TEXT_LAYER_EMPTY") {
    return new DocumentReadError("DOCUMENT_TEXT_LAYER_EMPTY", fileName);
  }
  if (/password|encrypted/i.test(error.message)) {
    return new DocumentReadError("DOCUMENT_PASSWORD_PROTECTED", fileName);
  }
  if (
    error.code === "FILE_CORRUPTED" ||
    error.code === "ZIP_NO_ENTRIES_FOUND" ||
    error.code === "ZIP_TRUNCATED" ||
    error.code === "REQUIRED_PART_MISSING"
  ) {
    return new DocumentReadError("DOCUMENT_CORRUPTED", fileName);
  }
  if (/invalid pdf|malformed|corrupt|unexpected end/i.test(error.message)) {
    return new DocumentReadError("DOCUMENT_CORRUPTED", fileName);
  }
  return new DocumentReadError("DOCUMENT_INTERNAL_ERROR", fileName, {
    cause: new Error(error.message),
  });
}
