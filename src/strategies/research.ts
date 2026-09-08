import { PARAMS } from "../config/params.js";

export interface Kline { open: number; high: number; low: number; close: number; time: number }
export type SignalFn = (i: number, klines: Kline[]) => 1 | -1 | 0; // signal using data up to bar i (no lookahead)

/** Binance public klines — no key needed. */
export async function fetchKlines(symbol: string, interval = "4h", limit = 200): Promise<Kline[]> {
  const res = await fetch(
    `${PARAMS.BINANCE_FAPI_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(500, limit)}`
  );
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const rows = (await res.json()) as (number | string)[][];
  return rows.map((r) => ({ time: Number(r[0]), open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
}

export interface BacktestResult {
  trades: number;
  wins: number;
  winRate: number;
  profitFactor: number;
  expectancyPct: number;
  maxAdversePct: number;
}

/** Minimal honest backtest: enter on signal, fixed TP/SL, no leverage fantasy. */
export function backtest(klines: Kline[], fn: SignalFn, tpPct = 3, slPct = 2): BacktestResult {
  let wins = 0, trades = 0, grossW = 0, grossL = 0, worst = 0;
  for (let i = 30; i < klines.length - 1; i++) {
    const s = fn(i, klines);
    if (!s) continue;
    trades++;
    const entry = klines[i + 1].open;
    let out = 0;
    for (let j = i + 1; j < klines.length; j++) {
      const k = klines[j];
      const fav = s === 1 ? ((k.high - entry) / entry) * 100 : ((entry - k.low) / entry) * 100;
      const adv = s === 1 ? ((entry - k.low) / entry) * 100 : ((k.high - entry) / entry) * 100;
      worst = Math.min(worst, -adv);
      if (fav >= tpPct) { out = tpPct; break; }
      if (adv >= slPct) { out = -slPct; break; }
      if (j === klines.length - 1) out = s === 1 ? ((k.close - entry) / entry) * 100 : ((entry - k.close) / entry) * 100;
    }
    if (out > 0) { wins++; grossW += out; } else grossL += Math.abs(out);
  }
  return {
    trades,
    wins,
    winRate: trades ? Math.round((wins / trades) * 100) : 0,
    profitFactor: grossL > 0 ? +(grossW / grossL).toFixed(2) : trades ? 99 : 0,
    expectancyPct: trades ? +(((grossW - grossL) / trades).toFixed(2)) : 0,
    maxAdversePct: +worst.toFixed(2),
  };
}

/**
 * Significance-lite: does the rule beat N random-entry baselines on the same
 * history? Returns how often random won — low means the rule has real edge.
 */
export function significance(klines: Kline[], fn: SignalFn, bootstraps = 60, seed = 7): { rule: BacktestResult; randomBeatRate: number } {
  const rule = backtest(klines, fn);
  let rnd = seed;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  let beaten = 0;
  for (let b = 0; b < bootstraps; b++) {
    const idx = new Set<number>();
    while (idx.size < Math.min(Math.max(rule.trades, 5), 40)) idx.add(30 + Math.floor(rand() * (klines.length - 32)));
    const arr = [...idx];
    // expectancy of random entries with same count, same TP/SL
    let ew = 0, el = 0, t = 0;
    for (const i of arr) {
      const dir = rand() > 0.5 ? 1 : -1;
      const entry = klines[Math.min(i + 1, klines.length - 1)].open;
      let out = 0;
      for (let j = i + 1; j < klines.length; j++) {
        const kk = klines[j];
        const fav = dir === 1 ? ((kk.high - entry) / entry) * 100 : ((entry - kk.low) / entry) * 100;
        const adv = dir === 1 ? ((entry - kk.low) / entry) * 100 : ((kk.high - entry) / entry) * 100;
        if (fav >= 3) { out = 3; break; }
        if (adv >= 2) { out = -2; break; }
        if (j === klines.length - 1) out = dir === 1 ? ((kk.close - entry) / entry) * 100 : ((entry - kk.close) / entry) * 100;
      }
      t++;
      if (out > 0) ew += out; else el += Math.abs(out);
    }
    const exp = t ? (ew - el) / t : 0;
    if (exp >= rule.expectancyPct && rule.trades > 0) beaten++;
  }
  return { rule, randomBeatRate: bootstraps ? +(beaten / bootstraps).toFixed(2) : 1 };
}

/** Monte-Carlo-lite: shuffle trade outcomes to see the drawdown range skill implies. */
export function mcDrawdownRange(pnls: number[], shuffles = 200, seed = 13): { medianMaxDD: number; worstMaxDD: number } {
  let rnd = seed;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const dds: number[] = [];
  for (let s = 0; s < shuffles; s++) {
    const arr = [...pnls];
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    let eq = 0, peak = 0, dd = 0;
    for (const p of arr) { eq += p; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
    dds.push(dd);
  }
  dds.sort((a, b) => a - b);
  return {
    medianMaxDD: +(dds[Math.floor(dds.length / 2)] ?? 0).toFixed(2),
    worstMaxDD: +(dds[0] ?? 0).toFixed(2),
  };
}
