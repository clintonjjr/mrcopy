export interface RiskConfig {
  cooldownMin: number; // sit out after a losing call
  maxStopsBeforeHalt: number; // N stop-outs -> halt for haltMin
  haltMin: number;
  maxDayDrawdownPct: number; // equity hard stop for the day
  benchColdAfterN: number; // bench a symbol after N flat/losing closes
}
export const DEFAULT_RISK: RiskConfig = {
  cooldownMin: 60,
  maxStopsBeforeHalt: 3,
  haltMin: 240,
  maxDayDrawdownPct: 6,
  benchColdAfterN: 3,
};

interface LossEvent { at: number; reason: string; symbol?: string }

/**
 * Protections: the risk manager. Cooldowns after losses, halts after
 * repeated stop-outs or a daily drawdown breach, benches cold symbols.
 * Advisory here (the execution agent enforces); the brain refuses to issue
 * fresh setups while halted.
 */
export class Protections {
  private losses: LossEvent[] = [];
  private cold: Map<string, number> = new Map();
  private haltedUntil = 0;
  private dayStart = Date.now();
  private dayPnlPct = 0;

  constructor(private cfg: RiskConfig = DEFAULT_RISK) {}

  noteClose(pnlPct: number, reason: string, symbol?: string) {
    const now = Date.now();
    if (now - this.dayStart > 24 * 3600_000) { this.dayStart = now; this.dayPnlPct = 0; this.losses = []; }
    this.dayPnlPct += pnlPct;
    if (pnlPct < 0) {
      this.losses.push({ at: now, reason, symbol });
      if (symbol) this.cold.set(symbol, (this.cold.get(symbol) ?? 0) + 1);
      const recentStops = this.losses.filter((l) => now - l.at < this.cfg.haltMin * 60_000 && l.reason.includes("stop")).length;
      if (recentStops >= this.cfg.maxStopsBeforeHalt) this.haltedUntil = now + this.cfg.haltMin * 60_000;
    } else if (symbol) {
      this.cold.set(symbol, 0);
    }
  }

  gate(symbol?: string): { ok: boolean; reason: string } {
    const now = Date.now();
    if (now < this.haltedUntil) return { ok: false, reason: `halted-until-${new Date(this.haltedUntil).toISOString()}` };
    if (this.dayPnlPct <= -this.cfg.maxDayDrawdownPct) return { ok: false, reason: `day-drawdown-${this.dayPnlPct.toFixed(1)}pct` };
    const lastLoss = [...this.losses].reverse()[0];
    if (lastLoss && now - lastLoss.at < this.cfg.cooldownMin * 60_000) {
      return { ok: false, reason: `cooldown-${Math.ceil((this.cfg.cooldownMin * 60_000 - (now - lastLoss.at)) / 60000)}m-left` };
    }
    if (symbol && (this.cold.get(symbol) ?? 0) >= this.cfg.benchColdAfterN) {
      return { ok: false, reason: `${symbol}-benched-cold` };
    }
    return { ok: true, reason: "clear" };
  }

  state() {
    return { dayPnlPct: +this.dayPnlPct.toFixed(2), haltedUntil: this.haltedUntil, cold: [...this.cold.entries()] };
  }
}

export interface UnstuckStep {
  action: "hold" | "bleed";
  closePct: number; // % of position to realize now
  reason: string;
}

/**
 * Unstuck engine: a losing, leader-abandoned position is bled out in small
 * scheduled realizes — nearest-to-breakeven first — instead of becoming a bag.
 */
export function unstuckStep(opts: {
  pnlPct: number; // current unrealized, negative
  minutesHeld: number;
  maxBleedPctPerStep?: number;
}): UnstuckStep {
  const { pnlPct, minutesHeld, maxBleedPctPerStep = 25 } = opts;
  if (pnlPct >= -2) return { action: "hold", closePct: 0, reason: "within-noise" };
  if (minutesHeld < 120) return { action: "hold", closePct: 0, reason: "too-early-give-it-room" };
  const depth = Math.min(1, Math.abs(pnlPct) / 15);
  const closePct = Math.round(Math.min(maxBleedPctPerStep, 10 + depth * 20));
  return { action: "bleed", closePct, reason: `stuck-${pnlPct.toFixed(1)}pct-${minutesHeld}m-bleed-${closePct}pct` };
}
