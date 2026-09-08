export interface RankInput {
  symbol: string;
  volume24h: number; // quote volume
  volatilityPct: number; // ATR%
  emaReady: boolean; // stack aligned (trend tradeable)
  fundingRate: number; // signed, e.g. 0.0004
  leaderConviction: number; // 0-100 from convergence, 0 if none
}
export interface Ranked extends RankInput {
  score: number;
  reasons: string[];
}

/**
 * Daily market ranker: decides WHERE the desk is allowed to play today.
 * Prunes dead coins, then scores volume, volatility, trend-readiness,
 * sane funding, and live leader conviction.
 */
export function rankMarkets(
  rows: RankInput[],
  weights = { volume: 25, volatility: 20, ema: 15, funding: 10, leaders: 30 }
): Ranked[] {
  const vols = rows.map((r) => r.volume24h).filter((v) => v > 0).sort((a, b) => a - b);
  const med = vols.length ? vols[Math.floor(vols.length / 2)] : 1;
  return rows
    .filter((r) => r.volume24h >= med * 0.25) // prune the graveyard
    .map((r) => {
      const reasons: string[] = [];
      let s = 0;
      const volScore = Math.min(1, r.volume24h / (med * 10));
      s += volScore * weights.volume;
      if (volScore > 0.7) reasons.push("deep-book");
      const sweet = r.volatilityPct >= 1 && r.volatilityPct <= 8;
      s += (sweet ? 1 : 0.3) * weights.volatility;
      reasons.push(sweet ? `vol-sweet-${r.volatilityPct.toFixed(1)}pct` : "vol-off-range");
      if (r.emaReady) { s += weights.ema; reasons.push("trend-tradeable"); }
      const crowded = Math.abs(r.fundingRate) > 0.001;
      s += (crowded ? 0 : 1) * weights.funding;
      if (crowded) reasons.push("funding-crowded");
      s += (Math.min(100, r.leaderConviction) / 100) * weights.leaders;
      if (r.leaderConviction > 0) reasons.push(`leaders-${Math.round(r.leaderConviction)}`);
      return { ...r, score: Math.round(s), reasons };
    })
    .sort((a, b) => b.score - a.score);
}
