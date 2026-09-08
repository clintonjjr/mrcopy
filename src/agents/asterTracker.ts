import { EventEmitter } from "node:events";
import { PARAMS } from "../config/params.js";
import type { LeaderEvent } from "./hyperliquidTracker.js";

/**
 * Universal leader ingest (named for history; serves every push venue).
 *
 * Honest constraint: privacy-default perp engines expose NO public endpoint
 * for another trader's positions, so non-Hyperliquid flow arrives as pushes
 * from an indexer you run (chain explorer API, firehose, or scraper) via
 * POST /ingest/aster, /ingest/custom, or /ingest with {"venue": "..."}.
 * Hyperliquid flow is polled automatically — see HyperliquidTracker.
 */
export class AsterTracker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private funding = new Map<string, number>();

  start() {
    void this.pollMarkets();
    this.timer = setInterval(() => void this.pollMarkets(), 60_000);
    console.log("[Aster] market monitor on (trader flow via POST /ingest/aster)");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  ingest(ev: {
    wallet: string;
    symbol: string;
    side: "LONG" | "SHORT" | "CLOSE" | "FLIP";
    venue?: string; // hyperliquid | aster | lighter | paradex | backpack | edgeX | custom…
    sizeHint?: number;
    entryPx?: number;
    leverage?: number;
    secret?: string;
  }): boolean {
    if (PARAMS.INGEST_SECRET && ev.secret !== PARAMS.INGEST_SECRET) return false;
    const coin = ev.symbol.replace(/USDT$/i, "").toUpperCase();
    const venue = (ev.venue ?? "aster").toLowerCase().replace(/[^a-z0-9-]/g, "") || "aster";
    const event: LeaderEvent = {
      venue,
      wallet: ev.wallet,
      coin,
      direction: ev.side,
      sizeHint: ev.sizeHint ?? 0,
      entryPx: ev.entryPx,
      leverage: ev.leverage,
      timestamp: Date.now(),
    };
    console.log(`[${venue}] ingest ${ev.wallet.slice(0, 8)}… → ${ev.side} ${coin}`);
    this.emit("leader", event);
    return true;
  }

  fundingOf(symbol: string): number | undefined {
    return this.funding.get(symbol.toUpperCase());
  }

  private async pollMarkets() {
    try {
      // Aster fapi mirrors Binance: premiumIndex + ticker/24hr are public.
      const res = await fetch(`${PARAMS.ASTER_FAPI_URL}/fapi/v1/premiumIndex`);
      if (!res.ok) return;
      const rows = (await res.json()) as { symbol: string; lastFundingRate?: string }[];
      for (const r of rows) {
        if (r.symbol && r.lastFundingRate) this.funding.set(r.symbol.toUpperCase(), parseFloat(r.lastFundingRate));
      }
    } catch (e) {
      console.error("[Aster] market poll failed:", (e as Error).message);
    }
  }
}
