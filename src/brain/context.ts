import { CallDB, TrustDB } from "../data/db.js";
import { LeaderStore } from "../data/leaders.js";
import { toBinanceSymbol } from "../config/params.js";
import type { BinanceLegTracker } from "../agents/binanceLegTracker.js";
import type { Protections } from "../strategies/risk.js";
import { PlanDB } from "../strategies/lifecycle.js";

export interface BrainContext {
  at: string;
  risk: { ok: boolean; reason: string; dayPnlPct: number };
  calls: ReturnType<typeof CallDB.active>;
  leaders: ReturnType<typeof LeaderStore.snapshot> & unknown[];
  leaderDetail: { wallet: string; coin: string; trust: number; tenureMin: number | null; adds: number; lastSide: string | null }[];
  market: { symbol: string; listed: boolean; markPrice?: number; fundingRate?: number; volume24h?: number }[];
  plans: ReturnType<typeof PlanDB.open>;
}

export interface BrainDeps {
  binance: BinanceLegTracker;
  risk: Protections;
  maxSymbols?: number;
}

/** Assemble everything the strategist may reason over. Bounded by design. */
export async function buildContext(deps: BrainDeps): Promise<BrainContext> {
  const leaders = LeaderStore.snapshot();
  const calls = CallDB.active();
  const symbols = [...new Set([
    ...calls.map((c) => c.binance_symbol).filter(Boolean),
    ...leaders.slice(0, 6).map((l) => toBinanceSymbol(l.coin)).filter(Boolean),
  ])].slice(0, deps.maxSymbols ?? 8);

  const market = await Promise.all(
    symbols.map((s) => deps.binance.check(s).catch(() => ({ symbol: s, listed: false as const })))
  );

  const leaderDetail = leaders.slice(0, 8).flatMap((l) =>
    l.wallets.slice(0, 5).map((w) => {
      const t = LeaderStore.tenureMs(w, l.coin);
      return {
        wallet: w,
        coin: l.coin,
        trust: +TrustDB.get(w).toFixed(2),
        tenureMin: t === null ? null : Math.round(t / 60000),
        adds: LeaderStore.addsCount(w, l.coin),
        lastSide: LeaderStore.lastSide(w, l.coin),
      };
    })
  );

  const gate = deps.risk.gate();
  return {
    at: new Date().toISOString(),
    risk: { ...gate, dayPnlPct: deps.risk.state().dayPnlPct },
    calls,
    leaders: leaders as BrainContext["leaders"],
    leaderDetail,
    market,
    plans: PlanDB.open(),
  };
}

/** Compact, token-cheap rendering for the LLM prompt. */
export function contextToPrompt(ctx: BrainContext): string {
  const lines: string[] = [`snapshot-at: ${ctx.at}`, `risk: ${ctx.risk.ok ? "CLEAR" : "HALTED-" + ctx.risk.reason} (day ${ctx.risk.dayPnlPct}%)`];
  lines.push(`active-calls: ${ctx.calls.length ? ctx.calls.map((c) => `#${c.id} ${c.direction} ${c.coin} conv${c.conviction}`).join(" | ") : "none"}`);
  for (const l of ctx.leaders.slice(0, 8) as { coin: string; walletCount: number; dominantSide: string; avgTenureMin: number; maxTenureMin: number; notional: number }[]) {
    lines.push(`leaders ${l.coin}: ${l.walletCount} wallets ${l.dominantSide} avg-tenure ${l.avgTenureMin}m max ${l.maxTenureMin}m ~$${l.notional}`);
  }
  for (const d of ctx.leaderDetail.slice(0, 20)) {
    lines.push(`  ${d.wallet.slice(0, 10)}… ${d.coin} trust ${d.trust} tenure ${d.tenureMin ?? "?"}m adds ${d.adds} last ${d.lastSide}`);
  }
  for (const m of ctx.market) {
    lines.push(`market ${m.symbol}: ${m.listed ? `mark ${m.markPrice} fund ${m.fundingRate} vol24 $${Math.round(m.volume24h ?? 0)}` : "NOT-LISTED"}`);
  }
  return lines.join("\n");
}
