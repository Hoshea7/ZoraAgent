/**
 * 流式平滑泵：把脉冲式到达的模型 delta 缓冲成匀速输出。
 *
 * 模型 token 的到达速率是噪声（网络 batch、工具执行间隙、推理忽快忽慢），
 * 直接渲染会让正文/思考"一顿一顿"或"一下子涌出"。泵把输入缓冲后按帧
 * 匀速放出：积压越多每帧放出越多，目标约 100ms 内追上实时，不拖尾。
 *
 * 生命周期事件（工具完成、turn 结束、快照合并）不走泵，调用方在边界处
 * 先 flush 残留，保证写入顺序正确。
 */

export type SmoothStreamKind = "text" | "thinking" | "toolInput";

export interface SmoothStreamKey {
  sessionId: string;
  kind: SmoothStreamKind;
  entityId?: string;
}

export interface SmoothStreamChunk {
  key: SmoothStreamKey;
  chunk: string;
}

export interface SmoothFlushFilter {
  kind?: SmoothStreamKind;
  entityId?: string;
}

/** 追赶窗口：一次爆发在 CATCHUP_FRAMES 帧（约 100ms）内匀速放完 */
export const CATCHUP_FRAMES = 6;
/** 每帧最少放出字符数：保证低速流的输出速率不低于常见到达速率，不积压 */
export const MIN_CHARS_PER_FRAME = 2;

/**
 * 本帧应放出的字符数：剩余量按剩余帧数匀速摊（平滑感的来源），
 * 但以 MIN_CHARS_PER_FRAME 为下限避免低速流积压，最后一帧全取。
 */
export function frameTake(pendingChars: number, framesRemaining: number): number {
  if (pendingChars <= 0) {
    return 0;
  }
  const evenShare = Math.ceil(pendingChars / Math.max(1, framesRemaining));
  return Math.min(Math.max(MIN_CHARS_PER_FRAME, evenShare), pendingChars);
}

function slotId(key: SmoothStreamKey): string {
  return JSON.stringify([key.sessionId, key.kind, key.entityId ?? null]);
}

function safePrefixLength(content: string, requestedLength: number): number {
  const length = Math.min(requestedLength, content.length);
  if (length <= 0 || length >= content.length) {
    return length;
  }

  const lastCodeUnit = content.charCodeAt(length - 1);
  const nextCodeUnit = content.charCodeAt(length);
  const splitsSurrogatePair =
    lastCodeUnit >= 0xd800 &&
    lastCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff;

  return splitsSurrogatePair ? length - 1 : length;
}

function matchesFilter(key: SmoothStreamKey, filter?: SmoothFlushFilter): boolean {
  if (!filter) {
    return true;
  }
  if (filter.kind !== undefined && key.kind !== filter.kind) {
    return false;
  }
  if (filter.entityId !== undefined && key.entityId !== filter.entityId) {
    return false;
  }
  return true;
}

/**
 * 纯缓冲逻辑，与调度解耦，方便测试。
 * 槽内 FIFO，槽间按入槽顺序。每次 enqueue 重置追赶窗口，
 * 一次脉冲爆发被摊成 CATCHUP_FRAMES 帧的匀速输出。
 */
export class StreamSmoothBuffer {
  private slots = new Map<
    string,
    { key: SmoothStreamKey; content: string; framesRemaining: number }
  >();
  private pendingChars = 0;

  get size(): number {
    return this.pendingChars;
  }

  enqueue(key: SmoothStreamKey, chunk: string): void {
    if (chunk.length === 0) {
      return;
    }

    const id = slotId(key);
    const existing = this.slots.get(id);
    if (existing) {
      existing.content += chunk;
      existing.framesRemaining = CATCHUP_FRAMES;
    } else {
      this.slots.set(id, { key, content: chunk, framesRemaining: CATCHUP_FRAMES });
    }
    this.pendingChars += chunk.length;
  }

  /** 每帧调用一次：各槽按剩余帧数匀速放出一段 */
  drainFrame(): SmoothStreamChunk[] {
    const drained: SmoothStreamChunk[] = [];

    for (const [id, slot] of this.slots) {
      const requestedTake = frameTake(slot.content.length, slot.framesRemaining);
      const take = safePrefixLength(slot.content, requestedTake);
      if (take <= 0) {
        continue;
      }

      const chunk = slot.content.slice(0, take);
      slot.content = slot.content.slice(take);
      slot.framesRemaining = Math.max(1, slot.framesRemaining - 1);
      drained.push({ key: slot.key, chunk });
      this.pendingChars -= take;

      if (slot.content.length === 0) {
        this.slots.delete(id);
      }
    }

    return drained;
  }

  /** 立即倒出匹配槽的全部内容（生命周期边界调用，保证不丢尾、不错位） */
  flush(sessionId?: string, filter?: SmoothFlushFilter): SmoothStreamChunk[] {
    const flushed: SmoothStreamChunk[] = [];

    for (const [id, slot] of this.slots) {
      const sessionMatches =
        sessionId === undefined || slot.key.sessionId === sessionId;
      if (!sessionMatches || !matchesFilter(slot.key, filter)) {
        continue;
      }
      flushed.push({ key: slot.key, chunk: slot.content });
      this.pendingChars -= slot.content.length;
      this.slots.delete(id);
    }

    return flushed;
  }

  clear(): void {
    this.slots.clear();
    this.pendingChars = 0;
  }
}

export interface SmoothScheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

const rafScheduler: SmoothScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * rAF 调度：有积压时按帧驱动 buffer，倒空后停转，不空转。
 */
export class StreamSmoother {
  private readonly buffer = new StreamSmoothBuffer();
  private rafHandle: number | null = null;

  constructor(
    private readonly emit: (chunk: SmoothStreamChunk) => void,
    private readonly scheduler: SmoothScheduler = rafScheduler
  ) {}

  get pendingSize(): number {
    return this.buffer.size;
  }

  enqueue(key: SmoothStreamKey, chunk: string): void {
    this.buffer.enqueue(key, chunk);
    this.schedule();
  }

  flush(sessionId: string, filter?: SmoothFlushFilter): void {
    for (const chunk of this.buffer.flush(sessionId, filter)) {
      this.emit(chunk);
    }
    this.stopIfIdle();
  }

  flushAll(): void {
    for (const chunk of this.buffer.flush()) {
      this.emit(chunk);
    }
    this.stopIfIdle();
  }

  dispose(): void {
    if (this.rafHandle !== null) {
      this.scheduler.cancel(this.rafHandle);
      this.rafHandle = null;
    }
    this.buffer.clear();
  }

  private schedule(): void {
    if (this.rafHandle !== null || this.buffer.size === 0) {
      return;
    }
    this.rafHandle = this.scheduler.request(() => {
      this.rafHandle = null;
      this.tick();
    });
  }

  private tick(): void {
    for (const chunk of this.buffer.drainFrame()) {
      this.emit(chunk);
    }
    this.schedule();
  }

  private stopIfIdle(): void {
    if (this.buffer.size > 0 || this.rafHandle === null) {
      return;
    }
    this.scheduler.cancel(this.rafHandle);
    this.rafHandle = null;
  }
}
