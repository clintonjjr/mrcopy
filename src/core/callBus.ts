import { PARAMS } from "../config/params.js";
import { CallDB } from "../data/db.js";
import type { SizedCall } from "../agents/marketFilter.js";
import type { ConvergenceSignal } from "../agents/signalDetector.js";

/** Canonical CALL object consumed by the Binance Agent OS execution agent. */
export interface TradeCall {
  id: number;
  action: "OPEN" | "EXIT";
  coin: string;
  binance_symbol: string;
  direction: "LONG" | "SHORT";
  conviction: number;
  leverage_suggested: number;
  entry_hint: string;
  stop_hint: string;
  tp_hints: string[];
  invalidation: string;
  wallets: string[];
  venues: string[];
  pre_binance_alpha: boolean;
  expires_at: string;
  note: string;
}

export async function publishCall(sig: ConvergenceSignal, sized: SizedCall): Promise<TradeCall> {
  const now = Date.now();
  const id = CallDB.insert({
    coin: sized.coin,
    binance_symbol: sized.binanceSymbol,
    direction: sized.direction,
    conviction: sized.conviction,
    wallets: JSON.stringify(sig.wallets),
    venues: JSON.stringify(sig.venues),
    entry_hint: sized.entryHint,
    leverage_suggested: sized.leverageSuggested,
    stop_hint: sized.stopHint,
    tp_hints: JSON.stringify(sized.tpHints),
    invalidation: sized.invalidation,
    pre_binance_alpha: sized.preBinanceAlpha ? 1 : 0,
    status: "active",
    created_at: now,
    expires_at: now + PARAMS.CALL_TTL_HOURS * 3600_000,
    exit_reason: null,
    pnl_pct: null,
    entry_mark: sized.markPrice ?? null,
    paper_pnl: null,
    paper_reason: null,
  });

  const call: TradeCall = {
    id,
    action: "OPEN",
    coin: sized.coin,
    binance_symbol: sized.binanceSymbol,
    direction: sized.direction,
    conviction: sized.conviction,
    leverage_suggested: sized.leverageSuggested,
    entry_hint: sized.entryHint,
    stop_hint: sized.stopHint,
    tp_hints: sized.tpHints,
    invalidation: sized.invalidation,
    wallets: sig.wallets,
    venues: sig.venues,
    pre_binance_alpha: sized.preBinanceAlpha,
    expires_at: new Date(now + PARAMS.CALL_TTL_HOURS * 3600_000).toISOString(),
    note: sized.preBinanceAlpha
      ? "EARLY ALPHA: not on Binance perps yet. Execution agent: wait for listing or use Spot/Convert."
      : "Place via Binance Agent OS sub-account (Spot or USDⓈ-M) per your risk limits.",
  };

  // Push to execution agent webhook if configured (fire-and-forget)
  if (PARAMS.EXECUTION_WEBHOOK_URL) {
    try {
      await fetch(PARAMS.EXECUTION_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(PARAMS.EXECUTION_WEBHOOK_SECRET ? { "X-Signal-Secret": PARAMS.EXECUTION_WEBHOOK_SECRET } : {}),
        },
        body: JSON.stringify(call),
      });
      console.log(`[Bus] pushed call #${id} to execution webhook`);
    } catch (e) {
      console.error("[Bus] webhook push failed:", (e as Error).message);
    }
  }
  return call;
}

export function activeCalls(): TradeCall[] {
  return CallDB.active().map((c) => ({
    id: c.id,
    action: "OPEN" as const,
    coin: c.coin,
    binance_symbol: c.binance_symbol,
    direction: c.direction as "LONG" | "SHORT",
    conviction: c.conviction,
    leverage_suggested: c.leverage_suggested,
    entry_hint: c.entry_hint,
    stop_hint: c.stop_hint,
    tp_hints: JSON.parse(c.tp_hints) as string[],
    invalidation: c.invalidation,
    wallets: JSON.parse(c.wallets) as string[],
    venues: JSON.parse(c.venues) as string[],
    pre_binance_alpha: c.pre_binance_alpha === 1,
    expires_at: new Date(c.expires_at).toISOString(),
    note: "",
  }));
}
