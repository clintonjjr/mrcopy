import { CallDB, TrustDB } from "../data/db.js";

/**
 * Learning engine — same philosophy as the memecoin agent:
 * wallets that called winners gain trust (0.0-2.0), losers decay.
 * Outcomes come from two streams: reported Binance fills
 * (POST /calls/:id/close — always wins ties) and paper scoring off the
 * mark price, so trust learns even when agents never report back.
 */
export class LearningEngine {
  async feedback(callId: number, pnlPct: number, exitReason: string) {
    const call = CallDB.get(callId);
    if (!call) return;
    if (call.status === "active") CallDB.close(callId, exitReason, pnlPct);
    const won = pnlPct > 0;
    const wallets = JSON.parse(call.wallets) as string[];
    for (const w of wallets) {
      const t = TrustDB.get(w);
      const next = Math.min(2, Math.max(0, t + (won ? 0.1 : -0.15)));
      TrustDB.upsert(w, next, won);
    }
    console.log(`[Learn] call #${callId} ${won ? "WIN" : "LOSS"} (${pnlPct}%) — trust updated for ${wallets.length} wallets`);
  }

  report(): string {
    const s = CallDB.stats();
    const trusts = TrustDB.all() as { wallet: string; trust: number; wins: number; losses: number }[];
    const lines = trusts.slice(0, 15).map((t) => `  ${t.wallet.slice(0, 10)}… trust ${t.trust.toFixed(2)} (${t.wins}W/${t.losses}L)`);
    return [
      `*MRCOPY REPORT*`,
      ``,
      `Calls: ${s.total} total | ${s.active} active | ${s.closed} closed | ${s.winRate}% win`,
      ``,
      `Wallet trust:`,
      lines.length ? lines.join("\n") : "  no feedback yet — close calls via POST /calls/:id/close",
    ].join("\n");
  }
}
