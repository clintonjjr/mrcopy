# Mrcopy (signal agent for Binance Agent OS)

> The memecoin agent watches wallets → scores → executes via Jupiter.
> This watches **smart perp traders on Hyperliquid + Aster** → scores → emits a
> **structured CALL** your own Binance Agent OS execution agent places via
> Spot / USDⓈ-M. **Signal-only: no Binance keys, no orders placed here.**

## Why this shape

Binance Agent OS only lets its known agents (Claude / ChatGPT / Codex / Cursor
over the Binance MCP server, dedicated sub-account, withdrawals blocked) trade.
So this repo is the **call agent**: it does the watching/scoring and hands a
clean JSON call to your execution agent. Binance typically lags Aster/HL on
listings and momentum — that lag is the edge.

## Architecture

```
src/
├── agents/
│   ├── hyperliquidTracker.ts  public clearinghouseState + userFills polling (lead venue)
│   ├── asterTracker.ts        public fapi markets + POST /ingest/aster pushes (privacy-default chain)
│   ├── binanceLegTracker.ts   public fapi: listing / funding / volume guard (lag confirmation)
│   ├── signalDetector.ts      2-5 wallet directional convergence (600s window)
│   ├── marketFilter.ts        conviction 0-100 + leverage suggestion + Binance guards
│   ├── exitMonitor.ts         leaders-close/flip + TTL → EXIT
│   ├── learningEngine.ts      wallet trust 0.0-2.0 via outcome feedback
│   ├── webhookServer.ts       REST: GET /calls/active, POST /ingest/*, POST /calls/:id/close
│   └── mcpServer.ts           MCP tools: get_active_calls, get_call_detail, ...
├── core/
│   ├── orchestrator.ts        signal → Binance check → conviction → publish → notify
│   ├── callBus.ts             canonical TradeCall + execution-webhook push
│   └── notifier.ts            Telegram CALL/EXIT pings
├── data/db.ts                 SQLite: calls, wallet_trust, fills_seen
├── soul/                      SOUL.md + PERSONALITY.md
└── skills/call-agent/SKILL.md Binance Skill Hub skill for your execution agent
```

## Setup

```bash
cd Mrcopy
npm install
cp .env.example .env
# edit .env: TRACKED_WALLETS=0xabc...,0xdef... (5-10 proven HL perp traders)
# find them: Hyperliquid leaderboard, HyperX, HyperTracker, AsterScan leaderboard
npm run dev
# monitor UI (black/yellow heartbeat scope + how-to-call-it): http://localhost:8787/
```

Execution agent wiring (your Binance OS side):
1. Connect the Binance MCP server (`binance.com/mcp/agentic`) in a dedicated
   sub-account. Fund only what the agent may lose.
2. Connect THIS repo too: `npm run mcp` (stdio) or poll `GET :8787/calls/active`.
3. Add `skills/call-agent/SKILL.md` to your execution agent (Skill Hub format).
4. Optionally set `EXECUTION_WEBHOOK_URL` so calls push to your agent.

## CALL object

```json
{
  "id": 1, "action": "OPEN", "coin": "HYPE", "binance_symbol": "HYPEUSDT",
  "direction": "LONG", "conviction": 78, "leverage_suggested": 3,
  "entry_hint": "market-or-limit-chase-0.2%", "stop_hint": "-2%",
  "tp_hints": ["+3%", "+6%", "runner"],
  "invalidation": "leaders-close-or-flip",
  "wallets": ["0x..."], "venues": ["hyperliquid", "aster"],
  "pre_binance_alpha": false, "expires_at": "2026-..."
}
```

`pre_binance_alpha=true` means leaders are in early on HL/Aster but Binance has
no perp yet — execution agent waits (or small Spot/Convert only).

## Aster honesty note

Aster's perp engine is privacy-default: no public endpoint reveals another
trader's positions. HL flow is automatic (on-chain polling); Aster trader flow
arrives via `POST /ingest/aster` from an indexer you run (AsterScan API,
Bitquery gRPC firehose, or scraper). Market/funding polling is automatic.

## Feedback loop

After your execution agent closes on Binance:
`POST /calls/:id/close {"pnlPct": 4.2, "exitReason": "tp1"}` → trust updates.

## Disclaimers

Experimental. Perps + leverage can liquidate. Paper-trade first
(`DRY_RUN=true`, small sub-account funding). Not financial advice.
