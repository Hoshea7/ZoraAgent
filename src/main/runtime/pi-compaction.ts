export const PI_AUTO_COMPACTION_THRESHOLD_RATIO = 0.8;

export function calculatePiCompactionReserveTokens(
  contextWindow: number
): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError("Pi context window must be a positive finite number");
  }

  return Math.ceil(contextWindow * (1 - PI_AUTO_COMPACTION_THRESHOLD_RATIO));
}

export function calculatePiCompactionThresholdTokens(
  contextWindow: number
): number {
  return Math.max(
    0,
    contextWindow - calculatePiCompactionReserveTokens(contextWindow)
  );
}
