# Mrcopy

### See where smart perp money is moving before the crowd does.

Mrcopy is a **real-time perp trading intelligence engine** that watches high-performing traders across **Hyperliquid and Aster**, detects when multiple traders independently move into the same asset, and turns that activity into structured trading signals.

Instead of staring at dozens of wallets, markets, and exchange feeds, you get the setups that actually matter:

**who moved → what they moved into → how strong the signal is → whether Binance is still behind → where the trade could enter → where it is invalidated → when to get out.**

Mrcopy is signal-only. It does not hold exchange API keys and does not place trades.

Your execution agent handles execution.

---

## The idea

The best information is often visible **before the chart looks obvious**.

A trader opens a large position on Hyperliquid.

Another experienced trader enters the same market.

Then another.

The asset starts moving.

But Binance hasn't fully caught up yet.

Individually, each wallet is noisy.

**Several proven traders independently making the same move within a short window is much more interesting.**

Mrcopy continuously looks for those moments.

```text
Smart traders
     ↓
Position & flow monitoring
     ↓
Multiple traders converge
     ↓
Signal scoring
     ↓
Binance lag / market checks
     ↓
Risk & validity checks
     ↓
       CALL
     ↓
Entry / Stop / TP / Invalidation
```

The result is not a list of wallets.

It's a **tradeable setup**.

---

# What you get

Every Mrcopy call is designed to be consumed immediately by either a human or another AI agent.

```json
{
  "action": "OPEN",
  "coin": "HYPE",
  "direction": "LONG",
  "conviction": 78,
  "leverage_suggested": 3,
  "entry_hint": "market-or-limit-chase-0.2%",
  "stop_hint": "-2%",
  "tp_hints": ["+3%", "+6%", "runner"],
  "invalidation": "leaders-close-or-flip",
  "wallets": ["0x..."],
  "venues": ["hyperliquid", "aster"],
  "pre_binance_alpha": false,
  "expires_at": "2026-..."
}
```

A signal tells your execution layer **what is happening and what conditions would make the trade wrong**.

That means your agent doesn't need to interpret:

> “BTC looks bullish.”

It receives something closer to:

> **3 tracked traders are converging LONG on HYPE, conviction 78, Binance has not fully caught up, suggested risk parameters are X/Y/Z, and the setup is invalid if the leaders close or flip.**

---

# Why Mrcopy exists

Perp markets are fragmented.

The exchange where you execute isn't necessarily where the earliest useful information appears.

Mrcopy watches those earlier venues and looks for **cross-trader agreement**, rather than relying on a single trader, a single indicator, or a generic market prediction.

### One trader

Usually noise.

### Many random traders

Usually more noise.

### Multiple proven traders entering the same market

Now you have something worth investigating.

Mrcopy is built around that distinction.

---

# From trader activity to a signal

Mrcopy doesn't blindly copy wallets.

A trader entering a position is only the beginning.

Signals pass through several checks before becoming actionable.

### 01 — Find the traders worth watching

Mrcopy maintains a pool of high-performing Hyperliquid traders and continuously updates that pool.

The system can discover new candidates from the Hyperliquid leaderboard instead of relying entirely on a hardcoded wallet list.

### 02 — Watch their moves

Mrcopy monitors position and fill activity and records meaningful changes.

### 03 — Look for convergence

The interesting event is when multiple trusted traders independently move in the same direction on the same market within a short period.

### 04 — Measure conviction

Not every convergence deserves a signal.

Position size, trader trust, direction, timing, market conditions, and other factors contribute to the resulting conviction score.

### 05 — Check Binance

Mrcopy checks whether the execution venue is already showing the move.

If Binance has already moved, the opportunity may have disappeared.

If the leaders are moving while Binance is still lagging, the signal becomes considerably more interesting.

### 06 — Define the trade

A valid call contains an entry idea, stop, take-profit ladder, expiration, and invalidation condition.

### 07 — Manage the outcome

Calls remain part of a lifecycle.

When a setup closes, its result feeds back into the system and influences wallet trust over time.

---

# The important distinction

Mrcopy is **not**:

- a copy-trading exchange
- a wallet tracker dashboard
- a generic trading bot
- a technical-indicator strategy
- an exchange account that trades for you
- an LLM pretending it can predict the market

It is a **signal layer between smart-money activity and execution.**

```text
                  Mrcopy
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
   Hyperliquid     Aster       Binance
     activity      flow       confirmation
        └────────────┼────────────┘
                     ↓
              Signal Engine
                     ↓
              Trading Signal
                     ↓
          Your execution agent
                     ↓
                  Binance
```

Mrcopy never needs your exchange credentials.

---

# Built for AI agents

Mrcopy exposes its trading intelligence through **REST and MCP**.

That means an AI trading agent can query Mrcopy directly instead of scraping dashboards or trying to reconstruct trader activity itself.

### MCP

Connect an agent to the live Mrcopy MCP server:

```bash
claude mcp add mrcopy --transport http https://mrcopylive.vercel.app/mcp
```

Codex, Cursor, and other MCP-compatible clients can connect through the same Streamable HTTP endpoint.

The MCP server currently exposes:

- `get_active_calls`
- `get_call_detail`
- `list_tracked_wallets`
- `get_performance`
- `get_briefing`
- `ask_brain`
- `list_plans`

An agent can therefore ask things like:

```text
What setups are active right now?

Which traders are currently converging?

What are today's highest-conviction calls?

Why did this signal trigger?

Which tracked wallets have been performing best?

What can I enter today?
```

---

# Or use the API directly

Live brain:

```text
https://mrcopy.100.61.3.35.nip.io
```

Active calls:

```bash
curl -s https://mrcopy.100.61.3.35.nip.io/calls/active
```

Today's briefing:

```bash
curl -s https://mrcopy.100.61.3.35.nip.io/briefing
```

Ask the strategist:

```bash
curl -s -X POST \
  -H 'Content-Type: application/json' \
  -d '{"question":"what can I enter today?"}' \
  https://mrcopy.100.61.3.35.nip.io/ask
```

Submit Aster trader flow:

```bash
curl -s -X POST \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0x...","symbol":"BTCUSDT","side":"LONG"}' \
  https://mrcopy.100.61.3.35.nip.io/ingest/aster
```

---

# It can push signals to your agent

You don't have to keep polling.

Set an execution webhook and Mrcopy can push events when calls open or close.

```text
CALL
  ↓
your execution agent
  ↓
Binance
```

This makes Mrcopy usable as an intelligence service inside a larger autonomous trading system.

---

# The signal has a memory

Mrcopy doesn't treat every wallet equally forever.

Wallets have a trust score.

When a trader repeatedly produces useful calls, their influence can increase.

When their signals consistently fail, their influence decreases.

The system therefore moves toward:

```text
observe
   ↓
trade outcome
   ↓
evaluate
   ↓
update trust
   ↓
future signals
```

The goal is simple:

**let outcomes determine who deserves attention.**

---

# Binance isn't the source of the signal

This is one of Mrcopy's core ideas.

Binance is primarily the **execution and confirmation venue**.

The signal can originate elsewhere.

Mrcopy watches Hyperliquid and Aster for early trader activity, then asks:

> **Has Binance caught up yet?**

If the move is already obvious on Binance, Mrcopy doesn't pretend that the same edge still exists.

Some setups are explicitly marked:

```text
pre_binance_alpha: true
```

That means the underlying trader activity is interesting, but Binance confirmation has not happened yet.

Your execution layer can decide whether that fits its strategy.

---

# Aster support

Aster works differently from Hyperliquid.

Hyperliquid exposes public trader activity that Mrcopy can monitor directly.

Aster does not provide the same public visibility into another trader's positions.

Mrcopy therefore accepts Aster trader-flow events through:

```text
POST /ingest/aster
```

This allows an external indexer, scraper, firehose, or other data source to feed Aster activity into Mrcopy.

Mrcopy doesn't pretend that information exists when the venue doesn't publicly expose it.

---

# Risk controls

Mrcopy is designed to **reject bad setups**, not manufacture trades.

Signals can be blocked by conditions such as:

- insufficient conviction
- stop cooldowns
- stop guards
- daily drawdown limits
- expired setups
- invalidated leader activity
- insufficient market conditions
- Binance confirmation failures

A system that knows when **not** to trade is more useful than one that always produces a signal.

---

# Live

### Mrcopy

**Landing + MCP**

[mrcopylive.vercel.app](https://mrcopylive.vercel.app)

**MCP**

[Mrcopy MCP endpoint](https://mrcopylive.vercel.app/mcp)

**Trading intelligence API**

[Mrcopy Brain](https://mrcopy.100.61.3.35.nip.io)

The live system currently includes:

- Hyperliquid trader tracking
- automatic trader discovery
- trader convergence detection
- Aster flow ingestion
- Binance market checks
- conviction scoring
- CALL / EXIT lifecycle
- wallet trust scoring
- LLM strategist
- rule-based fallback
- REST API
- MCP server
- execution webhooks
- Telegram notifications
- paper-trading mode

---

# Run it yourself

### Requirements

- Node.js 22+
- Docker
- Docker Compose

### Install

```bash
git clone https://github.com/clintonjjr/mrcopy.git
cd mrcopy

npm install
cp .env.example .env
```

### Run

```bash
npm run dev
```

Or with Docker:

```bash
docker compose up -d
```

Mrcopy stores calls, fills, wallet trust, and plans in SQLite.

---

# Configuration

Copy:

```bash
cp .env.example .env
```

Important configuration includes:

```env
DRY_RUN=true
```

for paper trading.

LLM strategist (leave `LLM_PROVIDER=none` for rule-based answers):

```env
LLM_PROVIDER=openai
LLM_API_KEY=
LLM_MODEL=
```

Optional integrations include:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EXECUTION_WEBHOOK_URL=
```

No exchange API key is required by Mrcopy.

---

# Architecture

The product is intentionally split into two responsibilities:

```text
                 MRCOPY
                   │
       ┌───────────┴───────────┐
       │                       │
   Intelligence             Delivery
       │                       │
  trader tracking          REST / MCP
  convergence              webhooks
  scoring                  Telegram
  risk gates
  lifecycle
  trust
       │
       ↓
   Trading call
```

The execution layer remains separate.

That separation means Mrcopy can provide intelligence to:

- an autonomous trading agent
- a custom trading bot
- a human trader
- another application
- an MCP-compatible AI client

without requiring access to the user's exchange account.

---

# Stack

### Runtime

- Node.js 22
- TypeScript
- Express
- SQLite
- Docker

### Intelligence

- Hyperliquid public API
- Aster market data + trader-flow ingestion
- Binance public market data
- OpenRouter
- Rule-based signal fallback

### Agent interface

- Model Context Protocol
- Streamable HTTP
- REST

### Deployment

- AWS
- Docker Compose
- Caddy
- Vercel

---

# Current limitations

Mrcopy is intentionally transparent about where its data comes from.

**Hyperliquid**

Public trader activity can be monitored automatically.

**Aster**

Trader activity requires an external ingestion source because equivalent public position visibility is not available.

**Binance**

Mrcopy uses public market data. It does not use Binance credentials and does not execute orders.

**Signals**

A high-conviction call is still a trading hypothesis, not a guarantee.

Markets can move against the tracked traders, liquidity can disappear, and Binance may never follow.

---

# Safety

Perpetual futures and leverage can result in rapid losses and liquidation.

Start with:

```env
DRY_RUN=true
```

Paper-trade the system before putting capital behind it.

Mrcopy is experimental software and is not financial advice.

---

# Project status

Mrcopy currently runs end-to-end as a live signal system.

The core loop is operational:

```text
discover traders
      ↓
watch activity
      ↓
detect convergence
      ↓
score opportunity
      ↓
check Binance
      ↓
generate CALL
      ↓
manage EXIT
      ↓
learn from outcome
```

The next layer is not making the dashboard bigger.

It is making the intelligence better.

---

## Mrcopy

**Don't copy everyone.**

**Watch the traders worth copying.**
