import { EventEmitter } from "node:events";
import { PARAMS } from "../config/params.js";
import { TrustDB } from "../data/db.js";
import type { LeaderEvent } from "./hyperliquidTracker.js";

export interface ConvergenceSignal {
  coin: string;
  direction: "LONG" | "SHORT";
  walletCount: number;
  wallets: string[];
  venues: string[];
  weightedTrust: number;
}

/**
 * Convergence engine — the memecoin agent's 2-5 wallet detector,
 * retuned for perps: direction matters (LONG vs SHORT), window is wider
 * (default 10 min), CLOSE/FLIP events are routed to the exit path.
 */
export class SignalDetector extends EventEmitter {
  private recent: LeaderEvent[] = [];

  onLeaderEvent(e: LeaderEvent): ConvergenceSignal | null {
    const now = Date.now();
    const windowMs = PARAMS.SIGNAL_WINDOW_SECONDS * 1000;
    this.recent.push(e);
    this.recent = this.recent.filter((r) => now - r.timestamp < windowMs);

    if (e.direction === "CLOSE" || e.direction === "FLIP") {
      this.emit("leaderExit", e);
      return null;
    }

    const peers = this.recent.filter(
      (r) => r.coin === e.coin && r.direction === e.direction && r.wallet !== e.wallet
    );
    const wallets = [...new Set([e.wallet, ...peers.map((p) => p.wallet)])];
    const venues = [...new Set([e.venue, ...peers.map((p) => p.venue)])];
    if (wallets.length < PARAMS.MIN_WALLETS_FOR_SIGNAL) return null;

    const weightedTrust = wallets.reduce((s, w) => s + TrustDB.get(w), 0) / wallets.length;
    if (weightedTrust < 0.5) return null; // distrusted cohort alone can't trigger

    return { coin: e.coin, direction: e.direction, walletCount: wallets.length, wallets, venues, weightedTrust };
  }
}
