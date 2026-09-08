// Clean-room indicator library. Pure functions over OHLC arrays.
// Nothing here predicts — it only describes momentum, trend and range.
export interface Candles {
  closes: number[];
  highs: number[];
  lows: number[];
}

export function sma(xs: number[], n: number): number {
  if (xs.length < n || n <= 0) return NaN;
  let s = 0;
  for (let i = xs.length - n; i < xs.length; i++) s += xs[i];
  return s / n;
}

export function ema(xs: number[], n: number): number {
  if (xs.length < n || n <= 0) return NaN;
  const k = 2 / (n + 1);
  let e = xs[xs.length - n];
  for (let i = xs.length - n + 1; i < xs.length; i++) e = xs[i] * k + e * (1 - k);
  return e;
}

export function rsi(closes: number[], n = 14): number {
  if (closes.length < n + 1) return NaN;
  let g = 0, l = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  const rs = g / l;
  return 100 - 100 / (1 + rs);
}

export function atr(c: Candles, n = 14): number {
  const { closes, highs, lows } = c;
  if (closes.length < n + 1) return NaN;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    s += tr;
  }
  return s / n;
}

/** Simplified Wilder ADX: trend strength 0-100. */
export function adx(c: Candles, n = 14): number {
  const { highs, lows, closes } = c;
  if (closes.length < 2 * n + 1) return NaN;
  let plus = 0, minus = 0, tr = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    if (up > dn && up > 0) plus += up;
    if (dn > up && dn > 0) minus += dn;
    tr += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  if (tr === 0) return 0;
  const diP = (plus / tr) * 100, diM = (minus / tr) * 100;
  const dx = ((Math.abs(diP - diM) / (diP + diM || 1)) * 100) || 0;
  return Math.min(100, dx);
}

export function bollinger(closes: number[], n = 20, mult = 2): { mid: number; upper: number; lower: number; pctB: number } {
  const mid = sma(closes, n);
  if (!isFinite(mid)) return { mid: NaN, upper: NaN, lower: NaN, pctB: NaN };
  const slice = closes.slice(-n);
  const sd = Math.sqrt(slice.reduce((s, x) => s + (x - mid) ** 2, 0) / n);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  const last = closes[closes.length - 1];
  return { mid, upper, lower, pctB: (last - lower) / ((upper - lower) || 1) };
}

export function donchian(c: Candles, n = 20): { upper: number; lower: number; breakout: "up" | "down" | "none" } {
  const h = c.highs.slice(-n), l = c.lows.slice(-n);
  if (!h.length) return { upper: NaN, lower: NaN, breakout: "none" };
  const upper = Math.max(...h.slice(0, -1));
  const lower = Math.min(...l.slice(0, -1));
  const last = c.closes[c.closes.length - 1];
  return { upper, lower, breakout: last > upper ? "up" : last < lower ? "down" : "none" };
}

/** EMA stack read: are short > mid > long (bull) or the reverse (bear)? */
export function emaStack(closes: number[]): { dir: "up" | "down" | "mixed"; e8: number; e21: number; e50: number } {
  const e8 = ema(closes, 8), e21 = ema(closes, 21), e50 = ema(closes, 50);
  if (![e8, e21, e50].every(isFinite)) return { dir: "mixed", e8, e21, e50 };
  return { dir: e8 > e21 && e21 > e50 ? "up" : e8 < e21 && e21 < e50 ? "down" : "mixed", e8, e21, e50 };
}

/** Volatility as ATR / price — the position-size dial. */
export function volatilityPct(c: Candles): number {
  const a = atr(c);
  const last = c.closes[c.closes.length - 1];
  if (!isFinite(a) || !last) return NaN;
  return (a / last) * 100;
}
