import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PARAMS, CALL_COUNT_BASE } from "../config/params.js";

export interface CallRow {
  id: number;
  coin: string;
  binance_symbol: string;
  direction: "LONG" | "SHORT";
  conviction: number;
  wallets: string; // JSON
  venues: string; // JSON, e.g. ["hyperliquid","aster"]
  entry_hint: string;
  leverage_suggested: number;
  stop_hint: string;
  tp_hints: string; // JSON
  invalidation: string;
  pre_binance_alpha: number; // 0/1
  status: "active" | "exited" | "expired";
  created_at: number;
  expires_at: number;
  exit_reason: string | null;
  pnl_pct: number | null;
  entry_mark: number | null; // Binance mark at publish — paper scoring anchor
  paper_pnl: number | null; // mark-price outcome (+TP / -SL / 0 ttl)
  paper_reason: string | null;
}

let db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (db) return db;
  const p = PARAMS.DB_PATH;
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coin TEXT NOT NULL,
      binance_symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      conviction REAL NOT NULL,
      wallets TEXT NOT NULL,
      venues TEXT NOT NULL,
      entry_hint TEXT NOT NULL,
      leverage_suggested REAL NOT NULL,
      stop_hint TEXT NOT NULL,
      tp_hints TEXT NOT NULL,
      invalidation TEXT NOT NULL,
      pre_binance_alpha INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      exit_reason TEXT,
      pnl_pct REAL,
      entry_mark REAL,
      paper_pnl REAL,
      paper_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS wallet_trust (
      wallet TEXT PRIMARY KEY,
      trust REAL NOT NULL DEFAULT 1.0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS fills_seen (
      key TEXT PRIMARY KEY,
      seen_at INTEGER NOT NULL
    );
  `);
  // idempotent migrations for DBs created before these columns existed
  const have = new Set(
    (db.prepare(`PRAGMA table_info(calls)`).all() as { name: string }[]).map((c) => c.name)
  );
  if (!have.has("entry_mark")) db.exec(`ALTER TABLE calls ADD COLUMN entry_mark REAL`);
  if (!have.has("paper_pnl")) db.exec(`ALTER TABLE calls ADD COLUMN paper_pnl REAL`);
  if (!have.has("paper_reason")) db.exec(`ALTER TABLE calls ADD COLUMN paper_reason TEXT`);
  return db;
}

export const CallDB = {
  insert(c: Omit<CallRow, "id">): number {
    const d = getDB();
    const r = d
      .prepare(
        `INSERT INTO calls (coin, binance_symbol, direction, conviction, wallets, venues,
          entry_hint, leverage_suggested, stop_hint, tp_hints, invalidation,
          pre_binance_alpha, status, created_at, expires_at, exit_reason, pnl_pct,
          entry_mark, paper_pnl, paper_reason)
         VALUES (@coin,@binance_symbol,@direction,@conviction,@wallets,@venues,
          @entry_hint,@leverage_suggested,@stop_hint,@tp_hints,@invalidation,
          @pre_binance_alpha,@status,@created_at,@expires_at,@exit_reason,@pnl_pct,
          @entry_mark,@paper_pnl,@paper_reason)`
      )
      .run(c as Record<string, unknown>);
    return Number(r.lastInsertRowid);
  },
  active(): CallRow[] {
    return getDB().prepare(`SELECT * FROM calls WHERE status='active' ORDER BY id DESC`).all() as CallRow[];
  },
  get(id: number): CallRow | undefined {
    return getDB().prepare(`SELECT * FROM calls WHERE id=?`).get(id) as CallRow | undefined;
  },
  findActive(coin: string, direction: string): CallRow | undefined {
    return getDB()
      .prepare(`SELECT * FROM calls WHERE coin=? AND direction=? AND status='active' ORDER BY id DESC LIMIT 1`)
      .get(coin, direction) as CallRow | undefined;
  },
  close(id: number, reason: string, pnl: number | null) {
    getDB().prepare(`UPDATE calls SET status='exited', exit_reason=?, pnl_pct=? WHERE id=?`).run(reason, pnl, id);
  },
  setPaper(id: number, pnl: number, reason: string) {
    getDB().prepare(`UPDATE calls SET paper_pnl=?, paper_reason=? WHERE id=? AND paper_pnl IS NULL`).run(pnl, reason, id);
  },
  history(limit = 12): CallRow[] {
    return getDB()
      .prepare(`SELECT * FROM calls WHERE status != 'active' ORDER BY id DESC LIMIT ?`)
      .all(limit) as CallRow[];
  },
  expireOverdue(now = Date.now()) {
    getDB().prepare(`UPDATE calls SET status='expired' WHERE status='active' AND expires_at < ?`).run(now);
  },
  stats() {
    const rows = getDB().prepare(`SELECT status, pnl_pct, paper_pnl FROM calls`).all() as Pick<
      CallRow, "status" | "pnl_pct" | "paper_pnl">[];
    const outcome = (r: Pick<CallRow, "pnl_pct" | "paper_pnl">) => r.pnl_pct ?? r.paper_pnl;
    const scored = rows.filter((r) => outcome(r) !== null && outcome(r) !== undefined);
    const wins = scored.filter((r) => (outcome(r) ?? 0) > 0).length;
    const closed = rows.filter((r) => r.status === "exited");
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      closed: closed.length,
      winRate: scored.length ? Math.round((wins / scored.length) * 100) : 0,
      // Served counter: every call from every connected agent, seeded at 1k.
      served: CALL_COUNT_BASE + rows.length,
    };
  },
};

export const TrustDB = {
  get(wallet: string): number {
    const row = getDB().prepare(`SELECT trust FROM wallet_trust WHERE wallet=?`).get(wallet) as { trust: number } | undefined;
    return row?.trust ?? 1.0;
  },
  upsert(wallet: string, trust: number, won: boolean) {
    const d = getDB();
    const cur = d.prepare(`SELECT * FROM wallet_trust WHERE wallet=?`).get(wallet) as
      | { trust: number; wins: number; losses: number }
      | undefined;
    if (!cur) {
      d.prepare(`INSERT INTO wallet_trust (wallet, trust, wins, losses) VALUES (?,?,?,?)`).run(
        wallet,
        trust,
        won ? 1 : 0,
        won ? 0 : 1
      );
    } else {
      d.prepare(`UPDATE wallet_trust SET trust=?, wins=wins+?, losses=losses+? WHERE wallet=?`).run(
        trust,
        won ? 1 : 0,
        won ? 0 : 1,
        wallet
      );
    }
  },
  all() {
    return getDB().prepare(`SELECT * FROM wallet_trust ORDER BY trust DESC`).all();
  },
};

export const FillDedupe = {
  seen(key: string): boolean {
    const row = getDB().prepare(`SELECT key FROM fills_seen WHERE key=?`).get(key);
    return !!row;
  },
  mark(key: string) {
    getDB().prepare(`INSERT OR IGNORE INTO fills_seen (key, seen_at) VALUES (?,?)`).run(key, Date.now());
  },
};
