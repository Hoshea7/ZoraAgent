export const PI_AUTO_COMPACTION_THRESHOLD_RATIO = 0.8;
export const PI_COMPACTION_RECENT_CONTEXT_RATIO = 0.1;

export function calculatePiCompactionReserveTokens(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError("Pi context window must be a positive finite number");
  }

  return Math.ceil(contextWindow * (1 - PI_AUTO_COMPACTION_THRESHOLD_RATIO));
}

export function calculatePiCompactionThresholdTokens(contextWindow: number): number {
  return contextWindow - calculatePiCompactionReserveTokens(contextWindow);
}

export function calculatePiCompactionKeepRecentTokens(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError("Pi context window must be a positive finite number");
  }

  return Math.ceil(contextWindow * PI_COMPACTION_RECENT_CONTEXT_RATIO);
}
