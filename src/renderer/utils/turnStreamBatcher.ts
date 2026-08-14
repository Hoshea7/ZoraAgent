export type TurnStreamDeltaKind = "text" | "thinking" | "toolInput";

export interface TurnStreamDelta {
  kind: TurnStreamDeltaKind;
  entityId?: string;
  chunk: string;
}

export interface TurnStreamBatch {
  sessionId: string;
  deltas: TurnStreamDelta[];
}

export interface TurnStreamFlushFilter {
  kind?: TurnStreamDeltaKind;
  entityId?: string;
}

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

const frameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

function matchesFilter(delta: TurnStreamDelta, filter?: TurnStreamFlushFilter) {
  return (
    (!filter?.kind || delta.kind === filter.kind) &&
    (!filter?.entityId || delta.entityId === filter.entityId)
  );
}

/**
 * Coalesces provider deltas into one store commit per animation frame.
 * Raw chunks and their ordering are preserved; no artificial character pacing is applied.
 */
export class TurnStreamBatcher {
  private pending = new Map<string, TurnStreamDelta[]>();
  private frameHandle: number | null = null;

  constructor(
    private readonly emit: (batch: TurnStreamBatch) => void,
    private readonly scheduler: FrameScheduler = frameScheduler
  ) {}

  enqueue(sessionId: string, delta: TurnStreamDelta) {
    if (!delta.chunk) {
      return;
    }
    const sessionDeltas = this.pending.get(sessionId);
    if (sessionDeltas) {
      sessionDeltas.push(delta);
    } else {
      this.pending.set(sessionId, [delta]);
    }
    this.schedule();
  }

  flush(sessionId: string, filter?: TurnStreamFlushFilter) {
    const sessionDeltas = this.pending.get(sessionId);
    if (!sessionDeltas) {
      return;
    }

    const emitted = sessionDeltas.filter((delta) => matchesFilter(delta, filter));
    const retained = sessionDeltas.filter((delta) => !matchesFilter(delta, filter));
    if (retained.length > 0) {
      this.pending.set(sessionId, retained);
    } else {
      this.pending.delete(sessionId);
    }
    if (emitted.length > 0) {
      this.emit({ sessionId, deltas: emitted });
    }
    this.cancelIdleFrame();
  }

  flushAll() {
    this.drain();
    this.cancelIdleFrame();
  }

  dispose() {
    if (this.frameHandle !== null) {
      this.scheduler.cancel(this.frameHandle);
      this.frameHandle = null;
    }
    this.pending.clear();
  }

  private schedule() {
    if (this.frameHandle !== null) {
      return;
    }
    this.frameHandle = this.scheduler.request(() => {
      this.frameHandle = null;
      this.drain();
    });
  }

  private drain() {
    const batches = [...this.pending.entries()];
    this.pending.clear();
    for (const [sessionId, deltas] of batches) {
      this.emit({ sessionId, deltas });
    }
  }

  private cancelIdleFrame() {
    if (this.pending.size === 0 && this.frameHandle !== null) {
      this.scheduler.cancel(this.frameHandle);
      this.frameHandle = null;
    }
  }
}
