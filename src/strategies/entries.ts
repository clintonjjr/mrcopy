export interface StagedOrder {
  step: number;
  trigger: string; // price hint, e.g. "-0.8%" relative or "market"
  sizePct: number; // % of planned position
  note: string;
}
export interface EntryPlan {
  kind: "dca-ladder" | "twap" | "single";
  direction: "LONG" | "SHORT";
  symbol: string;
  stages: StagedOrder[];
  rationale: string;
}

/**
 * DCA ladder: split the position so early copies get a better average when
 * price keeps running against the first fill. Sizes grow geometrically.
 */
export function planDCA(opts: {
  direction: "LONG" | "SHORT";
  symbol: string;
  steps?: number;
  stepDropPct?: number;
  growth?: number;
}): EntryPlan {
  const { direction, symbol, steps = 4, stepDropPct = 0.8, growth = 1.6 } = opts;
  const weights: number[] = [];
  let w = 1, total = 0;
  for (let i = 0; i < steps; i++) { weights.push(w); total += w; w *= growth; }
  const stages = weights.map((x, i) => ({
    step: i + 1,
    trigger: i === 0 ? "market" : `${(stepDropPct * (i + 1)).toFixed(1)}%-against-entry`,
    sizePct: Math.round((x / total) * 100),
    note: i === 0 ? "starter — proves the idea" : "averages the position if leaders add",
  }));
  return {
    kind: "dca-ladder",
    direction,
    symbol,
    stages,
    rationale: `${steps} stages over ~${(stepDropPct * steps).toFixed(1)}% adverse move; size grows x${growth} per step`,
  };
}

/**
 * TWAP chase: slice one order across time so a late copy doesn't slam the
 * book on Binance. Pure execution hygiene, no opinion on direction.
 */
export function planTWAP(opts: { direction: "LONG" | "SHORT"; symbol: string; slices?: number; everyMin?: number }): EntryPlan {
  const { direction, symbol, slices = 6, everyMin = 5 } = opts;
  const each = Math.round(100 / slices);
  const stages = Array.from({ length: slices }, (_, i) => ({
    step: i + 1,
    trigger: i === 0 ? "market" : `+${everyMin * (i + 1)}min`,
    sizePct: i === slices - 1 ? 100 - each * (slices - 1) : each,
    note: "time slice — cancels if invalidation hits first",
  }));
  return { kind: "twap", direction, symbol, stages, rationale: `${slices} slices every ${everyMin}min; cancel-all on invalidation` };
}
