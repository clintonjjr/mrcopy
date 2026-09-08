import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { activeCalls } from "../core/callBus.js";
import { CallDB, TrustDB } from "../data/db.js";
import { getPool, AutoWallets } from "../data/wallets.js";
import { loadSoul } from "../brain/soul.js";
import { buildContext } from "../brain/context.js";
import { answer } from "../brain/strategist.js";
import { getBriefing, type BriefingDeps } from "../brain/briefing.js";
import { PlanDB } from "../strategies/lifecycle.js";

export interface McpDeps extends BriefingDeps {
  soul: string;
}

/**
 * MCP tools for remote agents (Claude / ChatGPT / Codex / Cursor, or the
 * Binance Agent OS execution agent). Same builder serves stdio (local) and
 * Streamable HTTP (AWS) — see mcpHttp.ts.
 *
 * Tools: get_active_calls, get_call_detail, list_tracked_wallets,
 * get_performance, get_briefing, ask_brain, list_plans
 */
export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "mrcopy", version: "0.2.0" });

  server.tool("get_active_calls", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify({ calls: activeCalls() }, null, 2) }],
  }));

  server.tool("get_call_detail", { id: z.number() }, async ({ id }) => {
    const c = CallDB.get(id);
    return { content: [{ type: "text", text: JSON.stringify(c ?? { error: "not-found" }, null, 2) }] };
  });

  server.tool("list_tracked_wallets", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify({ wallets: getPool(), count: getPool().length, discovered: AutoWallets.count(), note: "pool = seeds + auto-discovered, rotated by discovery" }, null, 2) }],
  }));

  server.tool("get_performance", {}, async () => ({
    content: [
      { type: "text", text: JSON.stringify({ stats: CallDB.stats(), trust: TrustDB.all() }, null, 2) },
    ],
  }));

  server.tool("get_briefing", { refresh: z.boolean().optional() }, async ({ refresh }) => {
    const b = await getBriefing(deps, refresh ?? false);
    return { content: [{ type: "text", text: JSON.stringify(b, null, 2) }] };
  });

  server.tool("ask_brain", { question: z.string() }, async ({ question }) => {
    const ctx = await buildContext(deps);
    const wantsToday = /today|enter|watchlist|brief|setup|play/i.test(question);
    const setups = wantsToday ? (await getBriefing(deps)).setups : undefined;
    const a = await answer(question, ctx, deps.soul, setups);
    return { content: [{ type: "text", text: JSON.stringify({ provider: a.provider, text: a.text }, null, 2) }] };
  });

  server.tool("list_plans", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify({ plans: PlanDB.open() }, null, 2) }],
  }));

  return server;
}

export async function startMcp(deps: McpDeps) {
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
  console.log("[MCP] mrcopy tools live over stdio");
}

/** Convenience for `npm run mcp` — local trackers stay idle, brain serves. */
export async function startMcpStandalone(binance: BriefingDeps["binance"], risk: BriefingDeps["risk"]) {
  await startMcp({ binance, risk, soul: loadSoul() });
}
