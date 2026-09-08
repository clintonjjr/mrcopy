# Mrcopy on AWS — 24/7 brain

Mrcopy is signal-only (no exchange keys, no orders), so the AWS box holds no
trading credentials. It still needs `API_SECRET` — every agent wire except the
public UI feed requires it.

## 1. Launch

Any Ubuntu 22.04+ instance (t3.small is plenty) with Docker:

```bash
git clone <your-mrcopy-remote> && cd Mrcopy
cp .env.example .env
# edit .env: TRACKED_WALLETS, INGEST_SECRET, API_SECRET (long random),
# LLM_PROVIDER/LLM_API_KEY/LLM_MODEL (or leave none for rule-based),
# TELEGRAM_* for pings
docker compose up -d --build
curl -s http://localhost:8787/health
```

Data persists in `./data` (SQLite). Restart policy keeps it up across reboots.

## 2. Expose it (TLS, recommended)

Point a subdomain at the instance and terminate TLS in front:

```bash
# Caddy example — auto HTTPS
mrcopy.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Security group: open 443 only (plus 22 from your IP). Keep 8787 on
localhost — compose already binds `127.0.0.1:8787`.

## 3. Connect agents

**curl (any agent, any language):**

```bash
S=https://mrcopy.example.com; K=$API_SECRET
curl -s $S/calls/active                                   # open calls
curl -s -H "x-api-secret: $K" $S/briefing                 # enter-today board
curl -s -X POST -H "x-api-secret: $K" -H 'Content-Type: application/json' \
  -d '{"question":"what can I enter today?"}' $S/ask
curl -s -X POST -H "x-api-secret: $K" -H 'Content-Type: application/json' \
  -d '{"wallet":"0x...","symbol":"BTCUSDT","side":"LONG"}' $S/ingest/aster
```

**MCP (Claude / ChatGPT / Codex / Cursor):** add a Streamable-HTTP server
pointing at `https://mrcopy.example.com/mcp` with header
`Authorization: Bearer <API_SECRET>`. Tools: `get_active_calls`,
`get_call_detail`, `list_tracked_wallets`, `get_performance`, `get_briefing`,
`ask_brain`, `list_plans`. Local alternative: `npm run mcp` (stdio).

**Telegram:** set `TELEGRAM_*` — CALL / EXIT pings only.

## 4. Operate

- Logs: `docker compose logs -f`
- Update: `git pull && docker compose up -d --build`
- Tune the strategist with no deploy: edit `src/soul/SOUL.md` (it is the
  system prompt), rebuild.
- Rotate `API_SECRET` + `INGEST_SECRET` like passwords.
- Back up `./data/calls.db` — it holds calls, wallet trust, and plans.

## Notes

- Rule-based mode (`LLM_PROVIDER=none`) answers `/ask` and `/briefing`
  from live data with no model bill. Set a provider + model for narrative
  analysis; the soul and the research gate apply either way.
- The brain refuses fresh setups while protections halt (cooldowns,
  stop-guard, daily drawdown). That is load-bearing — don't bypass it.
