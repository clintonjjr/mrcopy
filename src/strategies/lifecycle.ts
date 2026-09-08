import { getDB } from "../data/db.js";
import { planDCA, planTWAP, type EntryPlan } from "./entries.js";
import { planGrid, type GridPlan } from "./grid.js";
import type { Ranked } from "./ranker.js";
import type { RuleVerdict } from "./signals.js";

export type ExecutorKind = "position" | "dca" | "grid" | "twap" | "harvest" | "mirror";
export interface Plan {
  id: number;
  kind: ExecutorKind;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry: EntryPlan | GridPlan;
  stopPct: number;
  tpLadder: { tpPct: number; closePct: number }[];
  state: "open" | "closed";
  created_at: number;
  close_reason: string | null;
}

export const PlanDB = {
  init() {
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL, symbol TEXT NOT NULL, direction TEXT NOT NULL,
        entry TEXT NOT NULL, stop_pct REAL NOT NULL, tp_ladder TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, close_reason TEXT
      );`);
  },
  spawn(p: Omit<Plan, "id" | "state" | "created_at" | "close_reason">): number {
    this.init();
    const r = getDB()
      .prepare(`INSERT INTO plans (kind,symbol,direction,entry,stop_pct,tp_ladder,state,created_at)
                VALUES (?,?,?,?,?,?,'open',?)`)
      .run(p.kind, p.symbol, p.direction, JSON.stringify(p.entry), p.stopPct, JSON.stringify(p.tpLadder), Date.now());
    return Number(r.lastInsertRowid);
  },
  open(): Plan[] {
    this.init();
    return (getDB().prepare(`SELECT * FROM plans WHERE state='open' ORDER BY id DESC`).all() as Record<string, unknown>[]).map(
      (r) => {
        const { entry, tp_ladder, ...rest } = r as Record<string, unknown> & { entry: string; tp_ladder: string };
        return { ...rest, entry: JSON.parse(entry), tpLadder: JSON.parse(tp_ladder) } as unknown as Plan;
      }
    );
  },
  close(id: number, reason: string) {
    this.init();
    getDB().prepare(`UPDATE plans SET state='closed', close_reason=? WHERE id=?`).run(reason, id);
  },
};

export interface Setup {
  symbol: string;
  coin: string;
  direction: "LONG" | "SHORT";
  executor: ExecutorKind;
  entry: EntryPlan | GridPlan;
  stopPct: number;
  tpLadder: { tpPct: number; closePct: number }[];
  conviction: number;
  reasons: string[];
}

/**
 * Controller: turns ranked markets + rule verdicts + risk gate into concrete
 * setups. One setup = one finite executor lifecycle (enter → manage → exit).
 * Range days get the grid; trends get DCA/TWAP entries with layered exits.
 */
export function buildSetups(opts: {
  ranked: Ranked[];
  verdicts: Map<string, RuleVerdict[]>; // symbol -> rule verdicts
  leaderDir: Map<string, "LONG" | "SHORT">; // symbol -> dominant leader side
  riskOk: (symbol: string) => { ok: boolean; reason: string };
  maxSetups?: number;
}): Setup[] {
  const { ranked, verdicts, leaderDir, riskOk, maxSetups = 5 } = opts;
  const out: Setup[] = [];
  for (const m of ranked) {
    if (out.length >= maxSetups) break;
    const gate = riskOk(m.symbol);
    if (!gate.ok) continue;
    const vs = (verdicts.get(m.symbol) ?? []).filter((v) => v.bias !== "FLAT").sort((a, b) => b.strength - a.strength);
    if (!vs.length && m.leaderConviction < 60) continue;
    const best = vs[0];
    // Rules outrank raw leader flow; leaders-only setups follow the dominant leader side.
    const dir: "LONG" | "SHORT" = best ? (best.bias as "LONG" | "SHORT") : (leaderDir.get(m.symbol) ?? "LONG");
    if (!vs.length && !leaderDir.has(m.symbol)) continue;
    const trend = best?.rule === "trend";
    const executor: ExecutorKind = !trend ? "grid" : m.leaderConviction >= 70 ? "dca" : "twap";
    const entry = executor === "grid"
      ? planGrid({ direction: dir, symbol: m.symbol })
      : executor === "dca"
        ? planDCA({ direction: dir, symbol: m.symbol })
        : planTWAP({ direction: dir, symbol: m.symbol });
    const conviction = Math.round(Math.min(100, m.score * 0.5 + (best?.strength ?? 0) * 0.3 + Math.min(30, m.leaderConviction * 0.3)));
    out.push({
      symbol: m.symbol,
      coin: m.symbol.replace(/USDT$/, ""),
      direction: dir,
      executor,
      entry,
      stopPct: 2,
      tpLadder: [{ tpPct: 3, closePct: 30 }, { tpPct: 6, closePct: 40 }, { tpPct: 12, closePct: 30 }],
      conviction,
      reasons: [...m.reasons, ...(best ? [`${best.rule}:${best.strength}`] : ["leaders-only"])],
    });
  }
  return out.sort((a, b) => b.conviction - a.conviction);
}
