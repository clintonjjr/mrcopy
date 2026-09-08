/**
 * Neutral book: ways to earn when direction is unclear. All advisory —
 * the execution agent sizes and places; the brain only qualifies setups.
 */

export function spreadSuitable(spreadBps: number, maxBps = 8): { ok: boolean; reason: string } {
  return spreadBps <= maxBps
    ? { ok: true, reason: `spread-${spreadBps.toFixed(1)}bps-tight-enough` }
    : { ok: false, reason: `spread-${spreadBps.toFixed(1)}bps-too-wide` };
}

/** Volatility-skew quoter: widen the side holding inventory, tighten the other. */
export function skewQuotes(opts: {
  mid: number;
  volatilityPct: number;
  inventoryBias: number; // -1..1, + means long inventory
  baseSpreadPct?: number;
}): { bid: number; ask: number; note: string } {
  const { mid, volatilityPct, inventoryBias, baseSpreadPct = 0.1 } = opts;
  const vol = Math.min(3, volatilityPct / 2);
  const half = baseSpreadPct / 2 + vol * 0.05;
  const skew = inventoryBias * vol * 0.08; // lean quotes against inventory
  return {
    bid: +(mid * (1 - (half + Math.max(0, skew)) / 100)).toFixed(6),
    ask: +(mid * (1 + (half + Math.max(0, -skew)) / 100)).toFixed(6),
    note: `half-spread ${half.toFixed(3)}% skew ${skew.toFixed(3)}%`,
  };
}

/** Lead-lag mirror: the fast venue printed, the slow one hasn't — trade the catch-up. */
export function lagSignal(leadPx: number, lagPx: number, thresholdBps = 15): { fire: boolean; dir: "LONG" | "SHORT" | null; gapBps: number } {
  const gapBps = ((leadPx - lagPx) / lagPx) * 10_000;
  if (Math.abs(gapBps) < thresholdBps) return { fire: false, dir: null, gapBps: +gapBps.toFixed(1) };
  return { fire: true, dir: gapBps > 0 ? "LONG" : "SHORT", gapBps: +gapBps.toFixed(1) };
}

/** Funding harvest: crowded longs pay shorts — take the paid side only past threshold. */
export function fundingHarvest(fundingRate: number, threshold = 0.0008): { take: boolean; side: "LONG" | "SHORT" | null; aprPct: number } {
  const aprPct = fundingRate * 3 * 365 * 100; // 8h periods
  if (Math.abs(fundingRate) < threshold) return { take: false, side: null, aprPct: +aprPct.toFixed(1) };
  return { take: true, side: fundingRate > 0 ? "SHORT" : "LONG", aprPct: +aprPct.toFixed(1) };
}

/** Hedge plan: neutralize existing exposure instead of closing at a loss. */
export function hedgePlan(spotExposureUsd: number, perpSide: "LONG" | "SHORT" | "FLAT"): string {
  if (perpSide !== "FLAT") return "already-hedged-or-directional";
  if (spotExposureUsd <= 0) return "nothing-to-hedge";
  return `short-perp-$${Math.round(spotExposureUsd)}-against-spot`;
}
