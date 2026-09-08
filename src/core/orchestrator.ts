import { HyperliquidTracker, type LeaderEvent } from "../agents/hyperliquidTracker.js";
import { AsterTracker } from "../agents/asterTracker.js";
import { BinanceLegTracker } from "../agents/binanceLegTracker.js";
import { SignalDetector } from "../agents/signalDetector.js";
import { MarketFilter } from "../agents/marketFilter.js";
import { ExitMonitor } from "../agents/exitMonitor.js";
import { LearningEngine } from "../agents/learningEngine.js";
import { Notifier } from "../core/notifier.js";
import { CallDB } from "../data/db.js";
import { LeaderStore } from "../data/leaders.js";
import { publishCall } from "../core/callBus.js";
import { Protections } from "../strategies/risk.js";
import { PlanDB } from "../strategies/lifecycle.js";
import { PARAMS } from "../config/params.js";
import { getPool } from "../data/wallets.js";
import { Discovery } from "../agents/discovery.js";

/**
 * The brain — wires venue trackers -> convergence -> Binance-leg filter ->
 * call bus. Mirrors the memecoin orchestrator's pipeline, minus custody:
 * signal → Binance check → conviction → publish → notify.
 */
export class Orchestrator {
  readonly hl = new HyperliquidTracker();
  readonly aster = new AsterTracker();
  readonly binance = new BinanceLegTracker();
  readonly signals = new SignalDetector();
  readonly filter = new MarketFilter(this.binance);
  readonly exits = new ExitMonitor(this.binance);
  readonly learning = new LearningEngine();
  readonly notifier = new Notifier();
  readonly discovery = new Discovery();
  readonly risk = new Protections({
    cooldownMin: PARAMS.RISK_COOLDOWN_MIN,
    maxStopsBeforeHalt: PARAMS.RISK_MAX_STOPS,
    haltMin: PARAMS.RISK_HALT_MIN,
    maxDayDrawdownPct: PARAMS.RISK_MAX_DAY_DD_PCT,
    benchColdAfterN: 3,
  });
  private processing = new Set<string>();

  brainDeps() {
    return { binance: this.binance, risk: this.risk };
  }

  async start() {
    console.log("\n╔════════════════════════════════════╗");
    console.log("║      MRCOPY v0.2 (signal+brain)    ║");
    console.log("║  HL + Aster lead · Binance follows ║");
    console.log("╚════════════════════════════════════╝\n");
    console.log(`[Orch] pool ${getPool().length} wallets (discovery refilling) · signal-only, no Binance keys`);

    const onLeader = (e: LeaderEvent) => void this.handleLeader(e);
    this.hl.on("leader", onLeader);
    this.aster.on("leader", onLeader);
    this.discovery.on("leader", onLeader);
    this.signals.on("leaderExit", (e: LeaderEvent) => this.exits.onLeaderExit(e));
    this.exits.on("exit", ({ callId, coin, reason }: { callId: number; coin: string; reason: string }) => {
      const rec = CallDB.get(callId);
      if (rec?.binance_symbol) {
        for (const p of PlanDB.open().filter((x) => x.symbol === rec.binance_symbol)) {
          PlanDB.close(p.id, reason);
        }
      }
      void this.notifier.notifyExit(callId, coin, reason);
    });

    this.hl.start();
    this.aster.start();
    this.discovery.start();
    this.exits.start();
  }

  private async handleLeader(e: LeaderEvent) {
    LeaderStore.record(e); // memory first — the brain reasons over tenure
    const sig = this.signals.onLeaderEvent(e);
    if (!sig) return;
    const key = `${sig.coin}:${sig.direction}`;
    if (this.processing.has(key)) return; // evaluation in flight — later leader events retrigger
    if (CallDB.findActive(sig.coin, sig.direction)) return;
    this.processing.add(key);
    try {
      console.log(`\n[Orch] convergence: ${sig.direction} ${sig.coin} x${sig.walletCount} wallets (${sig.venues.join("+")})`);
      const sized = await this.filter.evaluate(sig);
      if (sized.skipReason) {
        this.notifier.notifySkip(sig.coin, sized.skipReason);
        return;
      }
      if (CallDB.findActive(sig.coin, sig.direction)) return; // raced by concurrent evaluation
      const call = await publishCall(sig, sized);
      console.log(`  CALL #${call.id}: ${call.direction} ${call.coin} → ${call.binance_symbol || "PRE-BINANCE"} conviction ${call.conviction}`);
      if (call.binance_symbol) {
        PlanDB.spawn({
          kind: "position",
          symbol: call.binance_symbol,
          direction: call.direction,
          entry: { kind: "single", direction: call.direction, symbol: call.binance_symbol, stages: [{ step: 1, trigger: "market", sizePct: 100, note: "mirror leaders" }], rationale: "leader convergence" },
          stopPct: 2,
          tpLadder: [{ tpPct: 3, closePct: 20 }, { tpPct: 6, closePct: 30 }],
        });
      }
      await this.notifier.notifyCall(call);
    } finally {
      this.processing.delete(key);
    }
  }

  stop() {
    this.hl.stop();
    this.aster.stop();
    this.discovery.stop();
    this.exits.stop();
  }
}
