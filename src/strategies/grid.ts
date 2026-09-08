export interface GridLevel {
  level: number;
  offsetPct: number; // distance against entry that arms this rung
  sizePct: number;
  takeProfitPct: number;
}
export interface GridPlan {
  direction: "LONG" | "SHORT" | "BOTH";
  symbol: string;
  rungs: GridLevel[];
  note: string;
}

/**
 * Averaging grid: a small starter plus rungs that buy weakness (long) or
 * strength (short), each rung carrying its own take-profit markup so any
 * bounce closes the whole stack in profit. Expects chop; hates straight lines.
 */
export function planGrid(opts: {
  direction: "LONG" | "SHORT" | "BOTH";
  symbol: string;
  rungs?: number;
  spacingPct?: number;
  growth?: number;
  tpMarkupPct?: number;
}): GridPlan {
  const { direction, symbol, rungs = 5, spacingPct = 1.0, growth = 2.0, tpMarkupPct = 0.6 } = opts;
  const weights: number[] = [];
  let w = 1, total = 0;
  for (let i = 0; i < rungs; i++) { weights.push(w); total += w; w *= growth; }
  return {
    direction,
    symbol,
    rungs: weights.map((x, i) => ({
      level: i + 1,
      offsetPct: +(spacingPct * (i + 1)).toFixed(2),
      sizePct: Math.round((x / total) * 100),
      takeProfitPct: tpMarkupPct,
    })),
    note: `${rungs} rungs x${growth} growth, ${spacingPct}% spacing, ${tpMarkupPct}% markup. Pair with the unstuck engine — grids die on trends.`,
  };
}

export interface TrailCheck {
  armed: boolean;
  fire: boolean;
  detail: string;
}

/**
 * Trailing entry: only enter after price pushed past `pushPct` and retraced
 * `pullPct`. Buys pullbacks instead of chasing wicks.
 */
export function trailingEntry(prices: number[], direction: "LONG" | "SHORT", pushPct: number, pullPct: number): TrailCheck {
  if (prices.length < 3) return { armed: false, fire: false, detail: "warming-up" };
  const base = prices[0];
  const extreme = direction === "LONG" ? Math.min(...prices) : Math.max(...prices);
  const movedPct = ((extreme - base) / base) * 100 * (direction === "LONG" ? -1 : 1);
  if (movedPct < pushPct) return { armed: false, fire: false, detail: `push ${movedPct.toFixed(2)}% < ${pushPct}%` };
  const last = prices[prices.length - 1];
  const retracePct = ((last - extreme) / extreme) * 100 * (direction === "LONG" ? 1 : -1);
  if (retracePct >= pullPct) {
    return { armed: true, fire: true, detail: `pushed ${movedPct.toFixed(2)}%, retraced ${retracePct.toFixed(2)}% — enter` };
  }
  return { armed: true, fire: false, detail: `waiting retrace ${retracePct.toFixed(2)}%/${pullPct}%` };
}

/**
 * Trailing close: only take profit after a favorable push plus a retrace —
 * exits into early reversal instead of a fixed line.
 */
export function trailingClose(
  entryPx: number,
  prices: number[],
  direction: "LONG" | "SHORT",
  pushPct: number,
  pullPct: number
): TrailCheck {
  if (!prices.length) return { armed: false, fire: false, detail: "no-prices" };
  const signed = (p: number) => ((p - entryPx) / entryPx) * 100 * (direction === "LONG" ? 1 : -1);
  const best = Math.max(...prices.map(signed));
  if (best < pushPct) return { armed: false, fire: false, detail: `best ${best.toFixed(2)}% < ${pushPct}%` };
  const now = signed(prices[prices.length - 1]);
  if (best - now >= pullPct) {
    return { armed: true, fire: true, detail: `gave back ${(best - now).toFixed(2)}% from best — close` };
  }
  return { armed: true, fire: false, detail: `riding: now ${now.toFixed(2)}%, best ${best.toFixed(2)}%` };
}
