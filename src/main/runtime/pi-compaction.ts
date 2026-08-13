export const PI_AUTO_COMPACTION_THRESHOLD_RATIO = 0.8;

export function calculatePiCompactionReserveTokens(
  contextWindow: number,
  maxOutputTokens: number
): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError("Pi context window must be a positive finite number");
  }
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new TypeError("Pi max output tokens must be a positive finite number");
  }

  return Math.max(
    Math.ceil(contextWindow * (1 - PI_AUTO_COMPACTION_THRESHOLD_RATIO)),
    Math.ceil(maxOutputTokens)
  );
}

export function calculatePiCompactionThresholdTokens(
  contextWindow: number,
  maxOutputTokens: number
): number {
  return Math.max(
    0,
    contextWindow -
      calculatePiCompactionReserveTokens(contextWindow, maxOutputTokens)
  );
}
