/**
 * Exit schedules that adapt to time-in-trade: take fast money early,
 * then let a runner work under a trailing stop.
 */
export function roiLadder(minutesHeld: number): { tpPct: number; closePct: number }[] {
  if (minutesHeld < 30) return [{ tpPct: 3, closePct: 30 }, { tpPct: 6, closePct: 40 }, { tpPct: 12, closePct: 30 }];
  if (minutesHeld < 240) return [{ tpPct: 2, closePct: 40 }, { tpPct: 4, closePct: 40 }, { tpPct: 8, closePct: 20 }];
  return [{ tpPct: 1.5, closePct: 60 }, { tpPct: 3, closePct: 40 }]; // old trade: harvest, don't hope
}

export interface TrailState {
  bestFavorablePct: number; // best move in our favor so far
  stopPct: number; // current trailing stop distance
}

/** Ratchet the stop up as the trade works; never loosen it. */
export function updateTrailingStop(prev: TrailState, favorableNowPct: number, lockbackPct = 1.5): TrailState {
  const best = Math.max(prev.bestFavorablePct, favorableNowPct);
  const stop = best <= 0 ? prev.stopPct : Math.max(prev.stopPct, best - lockbackPct);
  return { bestFavorablePct: best, stopPct: stop };
}

export function stopHit(favorableNowPct: number, stopPct: number, hardStopPct: number): boolean {
  return favorableNowPct <= -Math.abs(hardStopPct) || (stopPct > 0 && favorableNowPct <= stopPct - Math.abs(hardStopPct) * 0);
}
