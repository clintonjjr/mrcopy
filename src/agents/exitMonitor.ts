import { EventEmitter } from "node:events";
import { PARAMS } from "../config/params.js";
import { CallDB, type CallRow } from "../data/db.js";
import { TrustDB } from "../data/db.js";
import type { LeaderEvent } from "./hyperliquidTracker.js";
import type { BinanceLegTracker } from "./binanceLegTracker.js";

function firstNum(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Math.abs(parseFloat(m[0])) : null;
}

/**
 * Exit monitor — the perps version of positionManager.
 * We don't hold positions here; we watch leaders and expire stale calls:
 *  - N leaders CLOSE/FLIP the same coin -> EXIT call (your execution agent
 *    closes/reduces on Binance).
 *  - TTL expires -> call marked expired.
 *
 * Paper scoring: every minute, active calls are marked against the Binance
 * mark price. First touch of TP (+3% style) or stop (-2% style) records a
 * paper outcome — so win rate and wallet trust exist even when execution
 * agents never report fills. Reported fills always override paper.
 */
export class ExitMonitor extends EventEmitter {
  private closes = new Map<string, { count: number; at: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private binance?: BinanceLegTracker) {
    super();
  }

  start() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const now = Date.now();
      // paper-flat anything expiring without an outcome
      for (const c of CallDB.active().filter((x) => x.expires_at < now && x.paper_pnl == null)) {
        CallDB.setPaper(c.id, 0, "expired-flat");
      }
      CallDB.expireOverdue(now);
      await this.paperScore();
    } catch (e) {
      console.error("[Exits] tick failed:", (e as Error).message);
    }
  }

  private async paperScore() {
    if (!this.binance) return;
    const open = CallDB.active().filter((c) => c.binance_symbol && c.entry_mark && c.paper_pnl == null);
    for (const c of open) {
      try {
        const mkt = await this.binance.check(c.binance_symbol);
        if (!mkt.listed || !mkt.markPrice || !c.entry_mark) continue;
        const tp = firstNum(JSON.parse(c.tp_hints as string)[0]) ?? 3;
        const sl = firstNum(c.stop_hint) ?? 2;
        const move =
          c.direction === "LONG"
            ? ((mkt.markPrice - c.entry_mark) / c.entry_mark) * 100
            : ((c.entry_mark - mkt.markPrice) / c.entry_mark) * 100;
        if (move >= tp) this.recordPaper(c, tp, "paper-tp");
        else if (move <= -sl) this.recordPaper(c, -sl, "paper-stop");
      } catch { /* one bad symbol never kills the tick */ }
    }
  }

  private recordPaper(c: CallRow, pnl: number, reason: string) {
    CallDB.setPaper(c.id, pnl, reason);
    const won = pnl > 0;
    for (const w of JSON.parse(c.wallets) as string[]) {
      const t = TrustDB.get(w);
      TrustDB.upsert(w, Math.min(2, Math.max(0, t + (won ? 0.1 : -0.15))), won);
    }
    console.log(`[Paper] call #${c.id} ${c.coin} ${won ? "WIN" : "LOSS"} (${pnl}%) via mark — trust updated`);
  }

  onLeaderExit(e: LeaderEvent) {
    const key = `${e.coin}`;
    const cur = this.closes.get(key) ?? { count: 0, at: Date.now() };
    if (Date.now() - cur.at > PARAMS.SIGNAL_WINDOW_SECONDS * 1000) {
      this.closes.set(key, { count: 1, at: Date.now() });
      return;
    }
    cur.count += 1;
    this.closes.set(key, cur);
    if (cur.count >= PARAMS.EXIT_ON_LEADERS_CLOSED) {
      this.closes.delete(key);
      const actives = CallDB.active().filter((c) => c.coin === e.coin);
      for (const a of actives) {
        CallDB.close(a.id, `leaders-closed-${cur.count}`, null);
        this.emit("exit", { callId: a.id, coin: a.coin, reason: `leaders-closed-${cur.count}` });
      }
    }
  }
}
