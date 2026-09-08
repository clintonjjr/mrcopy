import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { PARAMS } from "../config/params.js";
import { getPool } from "../data/wallets.js";
import { activeCalls } from "../core/callBus.js";
import { CallDB } from "../data/db.js";
import { buildContext } from "../brain/context.js";
import { answer } from "../brain/strategist.js";
import { getBriefing, type BriefingDeps } from "../brain/briefing.js";
import { PlanDB } from "../strategies/lifecycle.js";
import { mountMcpHttp } from "./mcpHttp.js";
import type { AsterTracker } from "../agents/asterTracker.js";
import type { LearningEngine } from "../agents/learningEngine.js";
import type { Protections } from "../strategies/risk.js";

export interface BrainEnv extends BriefingDeps {
  soul: string;
}

/**
 * Local REST + remote-agent surface. Served at :8787 locally and on the
 * AWS instance behind your reverse proxy.
 *
 *  GET  /                    -> monitor UI
 *  GET  /calls/active        -> active calls (open)
 *  GET  /calls/history       -> closed-call history (open)
 *  GET  /calls/:id           -> single call detail (open)
 *  GET  /stats               -> stats + tracked count (open)
 *  GET  /briefing            -> ranked "enter today" board (secret)
 *  POST /ask                 -> ask the brain {question} (secret)
 *  GET  /plans               -> open executor plans (secret)
 *  POST /ingest/aster|custom -> leader flow pushes, any venue via {"venue"} (ingest secret)
 *  POST /calls/:id/close     -> outcome feedback (secret)
 *  POST|GET|DELETE /mcp      -> MCP Streamable HTTP (bearer secret)
 *  GET  /health              -> liveness (open)
 */
export function createServer(aster: AsterTracker, learning: LearningEngine, brain: BrainEnv) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // CORS for the split deploy: the Vercel landing page calls this API
  // cross-origin. Secrets still gate every non-public wire.
  const corsAll = PARAMS.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && (corsAll.includes("*") || corsAll.includes(o))) {
      res.setHeader("Access-Control-Allow-Origin", o);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-api-secret,Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      return void res.status(204).end();
    }
    next();
  });

  const needSecret = (req: Request, res: Response, next: NextFunction) => {
    if (!PARAMS.API_SECRET) return next();
    const got = (req.headers["x-api-secret"] as string) ?? "";
    if (got !== PARAMS.API_SECRET) return void res.status(401).json({ error: "unauthorized" });
    next();
  };

  app.get("/health", (_req, res) => res.json({ ok: true, dryRun: PARAMS.DRY_RUN, brain: true }));

  app.get("/calls/active", (_req, res) => res.json({ calls: activeCalls() }));

  // NOTE: /calls/history must sit above /calls/:id or "history" matches :id.
  app.get("/calls/history", (_req, res) => {
    const limit = Math.min(24, Math.max(1, Number(_req.query.limit ?? 12) || 12));
    res.json({ history: CallDB.history(limit) });
  });

  app.get("/calls/:id", (req, res) => {
    const c = CallDB.get(Number(req.params.id));
    if (!c) return void res.status(404).json({ error: "not-found" });
    res.json({ call: c });
  });

  app.get("/stats", (_req, res) =>
    res.json({ stats: CallDB.stats(), trackedWallets: getPool().length })
  );

  app.get("/briefing", needSecret, async (req, res) => {
    try {
      const b = await getBriefing(brain, req.query.refresh === "1");
      res.json(b);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/ask", needSecret, async (req, res) => {
    const question = String(req.body?.question ?? "").slice(0, 1000);
    if (!question) return void res.status(400).json({ error: "question-required" });
    try {
      const ctx = await buildContext(brain);
      const wantsToday = /today|enter|watchlist|brief|setup|play/i.test(question);
      const setups = wantsToday ? (await getBriefing(brain)).setups : undefined;
      const a = await answer(question, ctx, brain.soul, setups);
      res.json({ provider: a.provider, text: a.text, setups: a.setups ?? setups ?? [] });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/plans", needSecret, (_req, res) => res.json({ plans: PlanDB.open() }));

  app.post("/ingest/aster", (req, res) => {
    const ok = aster.ingest(req.body ?? {});
    if (!ok) return void res.status(401).json({ error: "bad-secret" });
    res.json({ ok: true });
  });

  app.post("/ingest/custom", (req, res) => {
    const ok = aster.ingest(req.body ?? {});
    if (!ok) return void res.status(401).json({ error: "bad-secret" });
    res.json({ ok: true });
  });

  app.post("/calls/:id/close", needSecret, async (req, res) => {
    const id = Number(req.params.id);
    const { pnlPct, exitReason } = req.body ?? {};
    if (!Number.isFinite(pnlPct)) return void res.status(400).json({ error: "pnlPct-required" });
    const reason = String(exitReason ?? "reported");
    const rec = CallDB.get(id);
    await learning.feedback(id, Number(pnlPct), reason);
    (brain.risk as Protections).noteClose(Number(pnlPct), reason, rec?.binance_symbol);
    res.json({ ok: true });
  });

  mountMcpHttp(app, brain);

  // Monitor UI (single static page, same origin so no CORS issues)
  app.use(express.static(path.resolve("web")));

  return app;
}
