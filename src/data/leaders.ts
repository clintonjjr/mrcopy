import type { LeaderEvent } from "../agents/hyperliquidTracker.js";

interface FillRec {
  wallet: string;
  coin: string;
  side: "LONG" | "SHORT" | "CLOSE" | "FLIP";
  sizeHint: number;
  entryPx?: number;
  ts: number;
}

const MAX_FILLS = 4000;
const fills: FillRec[] = [];

/**
 * Leader memory: every leader event is kept so the brain can answer
 * "how long has this trader been in, and do they add or fade?"
 * Tenure = time since the earliest fill of the current open streak
 * (streak = everything after the most recent CLOSE/FLIP).
 */
export const LeaderStore = {
  record(e: LeaderEvent) {
    fills.push({
      wallet: e.wallet,
      coin: e.coin,
      side: e.direction,
      sizeHint: e.sizeHint,
      entryPx: e.entryPx,
      ts: e.timestamp,
    });
    if (fills.length > MAX_FILLS) fills.splice(0, fills.length - MAX_FILLS);
  },

  forWalletCoin(wallet: string, coin: string): FillRec[] {
    return fills.filter((f) => f.wallet === wallet && f.coin === coin);
  },

  /** ms the wallet has held its current streak, or null if flat/unknown. */
  tenureMs(wallet: string, coin: string, now = Date.now()): number | null {
    const fs = this.forWalletCoin(wallet, coin);
    if (!fs.length) return null;
    let start = fs[0].ts;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      if (f.side === "CLOSE" || f.side === "FLIP") {
        start = i + 1 < fs.length ? fs[i + 1].ts : now;
        break;
      }
      start = f.ts;
    }
    const last = fs[fs.length - 1];
    if (last.side === "CLOSE") return null;
    return Math.max(0, now - start);
  },

  lastSide(wallet: string, coin: string): FillRec["side"] | null {
    const fs = this.forWalletCoin(wallet, coin);
    return fs.length ? fs[fs.length - 1].side : null;
  },

  addsCount(wallet: string, coin: string): number {
    // fills in the current streak beyond the first = adds
    const fs = this.forWalletCoin(wallet, coin);
    let n = 0, inStreak = false;
    for (let i = fs.length - 1; i >= 0; i--) {
      if (fs[i].side === "CLOSE" || fs[i].side === "FLIP") break;
      if (fs[i].side === "LONG" || fs[i].side === "SHORT") { n++; inStreak = true; }
    }
    return inStreak ? Math.max(0, n - 1) : 0;
  },

  /** Per-coin rollup for the brain: who, which side, how long, how big. */
  snapshot(now = Date.now()) {
    const coins = new Map<string, { wallets: Set<string>; longs: number; shorts: number; notional: number; tenures: number[] }>();
    for (const f of fills) {
      if (now - f.ts > 24 * 3600_000) continue;
      let c = coins.get(f.coin);
      if (!c) { c = { wallets: new Set(), longs: 0, shorts: 0, notional: 0, tenures: [] }; coins.set(f.coin, c); }
      c.wallets.add(f.wallet);
      if (f.side === "LONG") c.longs++;
      if (f.side === "SHORT") c.shorts++;
      c.notional += f.sizeHint || 0;
    }
    return [...coins.entries()].map(([coin, c]) => {
      const wallets = [...c.wallets];
      const tenures = wallets
        .map((w) => this.tenureMs(w, coin, now))
        .filter((t): t is number => t !== null);
      const dominant = c.longs >= c.shorts ? ("LONG" as const) : ("SHORT" as const);
      return {
        coin,
        wallets,
        walletCount: wallets.length,
        longs: c.longs,
        shorts: c.shorts,
        dominantSide: dominant,
        notional: Math.round(c.notional),
        avgTenureMin: tenures.length ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length / 60000) : 0,
        maxTenureMin: tenures.length ? Math.round(Math.max(...tenures) / 60000) : 0,
      };
    }).sort((a, b) => b.walletCount - a.walletCount || b.notional - a.notional);
  },
};
