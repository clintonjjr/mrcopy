import { EventEmitter } from "node:events";
import { PARAMS } from "../config/params.js";
import { AutoWallets, getPool } from "../data/wallets.js";
import type { LeaderEvent } from "./hyperliquidTracker.js";

interface LBRow {
  ethAddress: string;
  accountValue: string;
  windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
}

/**
 * Discovery: the desk finds its own smart wallets. Nobody hardcodes them.
 *
 *  - Hyperliquid: syncs the public leaderboard (month-PnL ranked), promotes
 *    the top wallets into the pool automatically.
 *  - Aster flow: polls the public whale feed when reachable and turns big
 *    plaintext orders into pool members + leader events. Degrades silently
 *    while the feed is gated — no crashes, no fake data.
 *  - Rotation: wallets that fall off the board, or that the trust engine
 *    convicts, are disabled. The pool is capped; the .env seeds always stay.
 */
export class Discovery extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;

  start() {
    void this.sync();
    this.timer = setInterval(() => void this.sync(), PARAMS.DISCOVERY_EVERY_MIN * 60_000);
    console.log(`[Discovery] every ${PARAMS.DISCOVERY_EVERY_MIN}min — no hardcoded wallets`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sync() {
    await this.syncHL().catch((e) => console.error("[Discovery] HL sync failed:", (e as Error).message));
    await this.syncAsterWhales().catch((e) => console.error("[Discovery] Aster sync failed:", (e as Error).message));
  }

  private async syncHL() {
    const res = await fetch(`${PARAMS.HL_STATS_URL}/Mainnet/leaderboard`);
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    const j = (await res.json()) as { leaderboardRows: LBRow[] };
    const rows = (j.leaderboardRows ?? [])
      .map((r) => {
        const month = r.windowPerformances?.find(([w]) => w === "month")?.[1];
        return {
          address: r.ethAddress,
          source: "hl-leaderboard",
          monthPnl: month ? parseFloat(month.pnl) : NaN,
          equity: parseFloat(r.accountValue),
        };
      })
      .filter((r) => /^0x[a-fA-F0-9]{40}$/.test(r.address) && isFinite(r.monthPnl) && r.equity >= PARAMS.DISCOVERY_MIN_EQUITY)
      .sort((a, b) => b.monthPnl - a.monthPnl)
      .slice(0, PARAMS.DISCOVERY_TOP);
    if (!rows.length) return;
    AutoWallets.upsertSeen(rows);
    AutoWallets.ageMisses(PARAMS.DISCOVERY_EVERY_MIN * 60_000 * 3);
    const stale = AutoWallets.disableStale(3);
    const convicted = AutoWallets.disableDistrusted(0.5);
    const capped = AutoWallets.cap(PARAMS.POOL_MAX);
    console.log(`[Discovery] HL board top ${rows.length} pooled · pool ${getPool().length} · retired stale:${stale} convicted:${convicted} capped:${capped}`);
  }

  private async syncAsterWhales() {
    const res = await fetch(`${PARAMS.ASTERSCAN_URL}/whales`);
    if (!res.ok) return; // feed gated or re-indexing — try again next cycle
    const j = (await res.json()) as { ok?: boolean; data?: unknown };
    const list = (Array.isArray(j) ? j : (j.data as { whales?: unknown[]; orders?: unknown[] } | unknown[]) ?? []) as Record<string, unknown>[];
    const orders = Array.isArray(list) ? list : (list as { whales?: Record<string, unknown>[]; orders?: Record<string, unknown>[] }).whales
      ?? (list as { orders?: Record<string, unknown>[] }).orders ?? [];
    if (!orders.length) return;
    let added = 0, emitted = 0;
    for (const o of orders) {
      const wallet = String(o.user ?? o.wallet ?? o.address ?? o.trader ?? "");
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) continue;
      const symbol = String(o.symbol ?? o.pair ?? o.market ?? "");
      const coin = symbol.replace(/USDT$/i, "").toUpperCase();
      const sideRaw = String(o.side ?? "").toUpperCase();
      const notional = Number(o.notional ?? o.size ?? o.value ?? 0);
      AutoWallets.upsertSeen([{ address: wallet, source: "asterscan", monthPnl: 0 }]);
      added++;
      // Plaintext taker flow only — encrypted payloads are skipped upstream,
      // and we never guess direction.
      if (coin && (sideRaw === "BUY" || sideRaw === "SELL") && notional >= 25_000) {
        const ev: LeaderEvent = {
          venue: "asterscan",
          wallet,
          coin,
          direction: sideRaw === "BUY" ? "LONG" : "SHORT",
          sizeHint: notional,
          timestamp: Number(o.time ?? o.ts ?? Date.now()),
        };
        this.emit("leader", ev);
        emitted++;
      }
    }
    if (added) console.log(`[Discovery] AsterScan: ${added} whale wallets pooled, ${emitted} flow events`);
  }
}
