import { PARAMS, toBinanceSymbol } from "../config/params.js";
import { LeaderStore } from "../data/leaders.js";
import { CallDB } from "../data/db.js";
import type { BinanceLegTracker } from "../agents/binanceLegTracker.js";
import type { Protections } from "../strategies/risk.js";
import { evalAll, type RuleVerdict } from "../strategies/signals.js";
import { rankMarkets, type RankInput } from "../strategies/ranker.js";
import { buildSetups, type Setup } from "../strategies/lifecycle.js";
import { backtest, fetchKlines, significance, type Kline, type SignalFn } from "../strategies/research.js";
import { ema, bollinger, rsi, donchian, volatilityPct, type Candles } from "../lib/indicators.js";

const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

function toCandles(kl: Kline[]): Candles {
  return { closes: kl.map((k) => k.close), highs: kl.map((k) => k.high), lows: kl.map((k) => k.low) };
}

/** Rule adapters for the research gate — same math as live signals, no lookahead. */
function ruleFn(rule: "trend" | "revert" | "breakout"): SignalFn {
  return (i, kl) => {
    const slice = kl.slice(0, i + 1);
    const c = toCandles(slice);
    const cl = c.closes;
    if (rule === "trend") {
      const e8 = ema(cl, 8), e21 = ema(cl, 21);
      if (!isFinite(e8) || !isFinite(e21)) return 0;
      return e8 > e21 ? 1 : -1;
    }
    if (rule === "revert") {
      const bb = bollinger(cl), r = rsi(cl);
      if (!isFinite(bb.pctB) || !isFinite(r)) return 0;
      if (bb.pctB > 1 && r > 70) return -1;
      if (bb.pctB < 0 && r < 30) return 1;
      return 0;
    }
    const d = donchian(c);
    return d.breakout === "up" ? 1 : d.breakout === "down" ? -1 : 0;
  };
}

export interface Briefing {
  at: string;
  riskOk: boolean;
  riskReason: string;
  setups: (Setup & { gate?: { expectancy: number; winRate: number; randomBeat: number } })[];
  watched: string[];
  note: string;
}

export interface BriefingDeps {
  binance: BinanceLegTracker;
  risk: Protections;
}

let cache: Briefing | null = null;

/** "What can I enter today": rank → rules → research gate → setups. */
export async function buildBriefing(deps: BriefingDeps): Promise<Briefing> {
  const snap = LeaderStore.snapshot();
  const syms = [...new Set([
    ...snap.slice(0, 6).map((l) => toBinanceSymbol(l.coin)).filter(Boolean),
    ...MAJORS,
  ])].slice(0, 8);

  const verdicts = new Map<string, RuleVerdict[]>();
  const inputs: RankInput[] = [];
  const gates = new Map<string, { expectancy: number; winRate: number; randomBeat: number }>();
  const watched: string[] = [];

  await Promise.all(syms.map(async (symbol) => {
    try {
      const [mkt, kl] = await Promise.all([
        deps.binance.check(symbol),
        fetchKlines(symbol, "4h", 150),
      ]);
      if (!mkt.listed || kl.length < 60) return;
      watched.push(symbol);
      const c = toCandles(kl);
      const vs = evalAll(c);
      verdicts.set(symbol, vs);
      const coin = symbol.replace(/USDT$/, "");
      const call = CallDB.active().find((x) => x.binance_symbol === symbol);
      const snapRow = snap.find((l) => l.coin === coin);
      inputs.push({
        symbol,
        volume24h: mkt.volume24h ?? 0,
        volatilityPct: isFinite(volatilityPct(c)) ? volatilityPct(c) : 2,
        emaReady: vs[0].bias !== "FLAT",
        fundingRate: mkt.fundingRate ?? 0,
        leaderConviction: call?.conviction ?? Math.min(60, (snapRow?.walletCount ?? 0) * 15),
      });
      // research gate on the strongest live rule
      const best = vs.filter((v) => v.bias !== "FLAT").sort((a, b) => b.strength - a.strength)[0];
      if (best) {
        const fn = ruleFn(best.rule);
        const bt = backtest(kl, fn);
        const sig = significance(kl, fn, 20);
        gates.set(symbol, { expectancy: bt.expectancyPct, winRate: bt.winRate, randomBeat: sig.randomBeatRate });
      }
    } catch { /* symbol skipped — never let one bad feed kill the board */ }
  }));

  const ranked = rankMarkets(inputs);
  const leaderDir = new Map(snap.map((l) => [toBinanceSymbol(l.coin), l.dominantSide]));
  const setups = buildSetups({
    ranked,
    verdicts,
    leaderDir,
    riskOk: (s) => deps.risk.gate(s),
  }).map((s) => ({ ...s, gate: gates.get(s.symbol) }));

  // Soul law: a setup that fails the gate is not assigned.
  const gated = setups.filter((s) => {
    if (!s.gate) return true; // no data — allowed but flagged
    return s.gate.expectancy > 0 && s.gate.randomBeat < 0.5;
  });

  const gate = deps.risk.gate();
  cache = {
    at: new Date().toISOString(),
    riskOk: gate.ok,
    riskReason: gate.reason,
    setups: gate.ok ? gated : [],
    watched,
    note: gate.ok
      ? `${gated.length}/${setups.length} passed the research gate`
      : `halted: ${gate.reason}`,
  };
  return cache;
}

export async function getBriefing(deps: BriefingDeps, refresh = false): Promise<Briefing> {
  const ttl = PARAMS.BRIEFING_TTL_HOURS * 3600_000;
  if (!refresh && cache && Date.now() - new Date(cache.at).getTime() < ttl) return cache;
  return buildBriefing(deps);
}
