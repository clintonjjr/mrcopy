import { getDB } from "./db.js";
import { TRACKED_WALLETS, PARAMS } from "../config/params.js";

/**
 * The wallet pool. Nobody hardcodes the desk's universe:
 * `.env` seeds are just the starting rumor; discovery fills the pool
 * from live leaderboards and flow, and rotation drops the dead.
 * Pool = seeds + enabled discovered wallets, capped.
 */
export function ensureWalletTables() {
  getDB().exec(`
    CREATE TABLE IF NOT EXISTS auto_wallets (
      address TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      month_pnl REAL NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      misses INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0
    );`);
}

export function getPool(): string[] {
  ensureWalletTables();
  const max = PARAMS.POOL_MAX;
  const auto = getDB()
    .prepare(`SELECT address FROM auto_wallets WHERE disabled=0 ORDER BY last_seen DESC LIMIT ?`)
    .all(max) as { address: string }[];
  const set = new Set<string>();
  for (const w of TRACKED_WALLETS) set.add(w.toLowerCase());
  for (const a of auto) set.add(a.address.toLowerCase());
  return [...set].slice(0, max);
}

export const AutoWallets = {
  upsertSeen(rows: { address: string; source: string; monthPnl: number }[]) {
    ensureWalletTables();
    const now = Date.now();
    const stmt = getDB().prepare(`
      INSERT INTO auto_wallets (address, source, month_pnl, added_at, last_seen, misses, disabled)
      VALUES (?,?,?,?,?,0,0)
      ON CONFLICT(address) DO UPDATE SET source=excluded.source, month_pnl=excluded.month_pnl,
        last_seen=excluded.last_seen, misses=0, disabled=0`);
    const tx = getDB().transaction((rs: typeof rows) => {
      for (const r of rs) stmt.run(r.address.toLowerCase(), r.source, r.monthPnl, now, now);
    });
    tx(rows);
  },
  /** Wallets we track but haven't seen on the board for a while. */
  ageMisses(olderThanMs: number) {
    ensureWalletTables();
    getDB().prepare(`UPDATE auto_wallets SET misses = misses + 1 WHERE disabled=0 AND last_seen < ?`)
      .run(Date.now() - olderThanMs);
  },
  disableStale(maxMisses: number): number {
    ensureWalletTables();
    const r = getDB().prepare(`UPDATE auto_wallets SET disabled=1 WHERE disabled=0 AND misses >= ?`).run(maxMisses);
    return Number(r.changes);
  },
  /** Drop wallets the trust engine has convicted (explicit low trust only). */
  disableDistrusted(minTrust: number): number {
    ensureWalletTables();
    const low = getDB().prepare(`SELECT wallet FROM wallet_trust WHERE trust < ?`).all(minTrust) as { wallet: string }[];
    if (!low.length) return 0;
    let n = 0;
    for (const w of low) {
      const r = getDB().prepare(`UPDATE auto_wallets SET disabled=1 WHERE address=? AND disabled=0`).run(w.wallet.toLowerCase());
      n += Number(r.changes);
    }
    return n;
  },
  cap(max: number): number {
    ensureWalletTables();
    const r = getDB().prepare(`
      UPDATE auto_wallets SET disabled=1 WHERE disabled=0 AND address NOT IN (
        SELECT address FROM auto_wallets WHERE disabled=0 ORDER BY last_seen DESC LIMIT ?
      )`).run(max);
    return Number(r.changes);
  },
  count(): number {
    ensureWalletTables();
    const r = getDB().prepare(`SELECT COUNT(*) as n FROM auto_wallets WHERE disabled=0`).get() as { n: number };
    return r.n;
  },
};
