export interface PiTurnGuard {
  shouldStopAfterTurn: () => boolean;
  reset: () => void;
}

export function createTurnGuard(maxTurns = 50): PiTurnGuard {
  const limit = Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 1;
  let turnCount = 0;

  return {
    shouldStopAfterTurn: () => {
      turnCount += 1;
      return turnCount >= limit;
    },
    reset: () => {
      turnCount = 0;
    },
  };
}
