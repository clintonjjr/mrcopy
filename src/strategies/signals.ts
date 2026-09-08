import { adx, bollinger, donchian, ema, emaStack, rsi, volatilityPct, type Candles } from "../lib/indicators.js";

export type Bias = "LONG" | "SHORT" | "FLAT";
export interface RuleVerdict {
  rule: "trend" | "revert" | "breakout";
  bias: Bias;
  strength: number; // 0-100
  reasons: string[];
}

/** Trend rule: aligned EMA stack + ADX confirmation. */
export function evalTrend(c: Candles): RuleVerdict {
  const reasons: string[] = [];
  const stack = emaStack(c.closes);
  const a = adx(c);
  const e8 = ema(c.closes, 8);
  const last = c.closes[c.closes.length - 1];
  let bias: Bias = "FLAT", strength = 0;
  if (stack.dir === "up" && last > e8) { bias = "LONG"; strength += 40; reasons.push("ema-stack-up"); }
  else if (stack.dir === "down" && last < e8) { bias = "SHORT"; strength += 40; reasons.push("ema-stack-down"); }
  if (isFinite(a)) {
    if (a > 25 && bias !== "FLAT") { strength += 30; reasons.push(`adx-${Math.round(a)}`); }
    else if (a <= 20) { strength = Math.max(0, strength - 20); reasons.push("adx-weak"); }
  }
  return { rule: "trend", bias, strength: Math.min(100, strength), reasons };
}

/** Mean-reversion rule: stretched %B + RSI extreme. */
export function evalRevert(c: Candles): RuleVerdict {
  const reasons: string[] = [];
  const bb = bollinger(c.closes);
  const r = rsi(c.closes);
  let bias: Bias = "FLAT", strength = 0;
  if (!isFinite(bb.pctB) || !isFinite(r)) return { rule: "revert", bias, strength, reasons: ["not-enough-data"] };
  if (bb.pctB > 1 && r > 70) { bias = "SHORT"; strength += 45; reasons.push(`pctB-${bb.pctB.toFixed(2)}-rsi-${Math.round(r)}`); }
  else if (bb.pctB < 0 && r < 30) { bias = "LONG"; strength += 45; reasons.push(`pctB-${bb.pctB.toFixed(2)}-rsi-${Math.round(r)}`); }
  else if (r > 65 || r < 35) { strength += 15; reasons.push("rsi-lean"); }
  return { rule: "revert", bias, strength: Math.min(100, strength), reasons };
}

/** Breakout rule: Donchian break + volatility expansion. */
export function evalBreakout(c: Candles): RuleVerdict {
  const reasons: string[] = [];
  const d = donchian(c);
  const vol = volatilityPct(c);
  let bias: Bias = "FLAT", strength = 0;
  if (d.breakout === "up") { bias = "LONG"; strength += 45; reasons.push("donchian-break-up"); }
  else if (d.breakout === "down") { bias = "SHORT"; strength += 45; reasons.push("donchian-break-down"); }
  if (isFinite(vol) && vol > 1.5 && bias !== "FLAT") { strength += 20; reasons.push(`vol-${vol.toFixed(2)}pct`); }
  return { rule: "breakout", bias, strength: Math.min(100, strength), reasons };
}

export function evalAll(c: Candles): RuleVerdict[] {
  return [evalTrend(c), evalRevert(c), evalBreakout(c)];
}
