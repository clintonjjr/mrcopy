import { PARAMS, toBinanceSymbol } from "../config/params.js";
import { BinanceLegTracker, type BinanceMarket } from "./binanceLegTracker.js";
import type { ConvergenceSignal } from "./signalDetector.js";

export interface SizedCall {
  coin: string;
  binanceSymbol: string;
  direction: "LONG" | "SHORT";
  conviction: number; // 0-100
  leverageSuggested: number;
  entryHint: string;
  stopHint: string;
  tpHints: string[];
  invalidation: string;
  preBinanceAlpha: boolean;
  markPrice?: number; // Binance mark at scoring time — paper-score anchor
  skipReason?: string;
}

/**
 * Market filter + sizer. Replaces the memecoin tokenAnalyzer + tradeExecutor:
 * no swaps here — we score, size the *suggestion*, and guard the Binance leg.
 * The execution agent (Binance Agent OS) owns balance, margin mode, and fills.
 */
export class MarketFilter {
  constructor(private binance: BinanceLegTracker) {}

  async evaluate(sig: ConvergenceSignal): Promise<SizedCall> {
    const binanceSymbol = toBinanceSymbol(sig.coin);
    const base: SizedCall = {
      coin: sig.coin,
      binanceSymbol,
      direction: sig.direction,
      conviction: 0,
      leverageSuggested: 3,
      entryHint: "market-or-limit-chase-0.2%",
      stopHint: "-2%",
      tpHints: ["+3%", "+6%", "runner"],
      invalidation: "leaders-close-or-flip",
      preBinanceAlpha: false,
    };

    // Conviction: wallet count (50) + trust (30) + cross-venue bonus (20).
    // Baseline 20 so a clean 2-wallet signal can clear the default 60 bar.
    const countScore = Math.min(50, 20 + sig.walletCount * 10);
    const trustScore = Math.min(30, sig.weightedTrust * 15);
    // any second independent venue counts the same — cross-venue is the signal
    const venueBonus = sig.venues.length > 1 ? 20 : 10;
    const conviction = Math.round(Math.min(100, countScore + trustScore + venueBonus));
    base.conviction = conviction;

    if (!binanceSymbol) return { ...base, skipReason: "no-binance-mapping" };
    const mkt: BinanceMarket = await this.binance.check(binanceSymbol).catch(() => ({ symbol: binanceSymbol, listed: true }));
    if (!mkt.listed) {
      base.preBinanceAlpha = true;
      if (!PARAMS.ALLOW_PRE_BINANCE_ALPHA) return { ...base, skipReason: "not-on-binance-perps" };
      base.invalidation += "-or-binance-lists-then-momentum-confirms";
      return base;
    }
    if (mkt.markPrice) base.markPrice = mkt.markPrice;

    // Funding crowded guard: extreme funding against our direction = crowded
    if (mkt.fundingRate !== undefined) {      const f = mkt.fundingRate;
      if (sig.direction === "LONG" && f > 0.001) base.conviction = Math.max(0, base.conviction - 10);
      if (sig.direction === "SHORT" && f < -0.001) base.conviction = Math.max(0, base.conviction - 10);
      if (Math.abs(f) > 0.002) base.leverageSuggested = 2;
    }
    if ((mkt.volume24h ?? Infinity) < 5_000_000) {
      return { ...base, skipReason: `binance-24h-volume-too-thin` };
    }

    base.leverageSuggested = conviction >= 85 ? 5 : conviction >= 70 ? 3 : 2;
    if (conviction < PARAMS.MIN_CONVICTION) return { ...base, skipReason: `conviction-${conviction}-below-${PARAMS.MIN_CONVICTION}` };
    return base;
  }
}
