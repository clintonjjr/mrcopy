# Mrcopy security

## The keyless trade

Mrcopy is intentionally keyless: no `API_SECRET`, no `INGEST_SECRET`, no
auth on REST or MCP. Any agent — yours or a stranger's — can read calls,
ask the brain, and push flow into `/ingest`.

That is a chosen trade, same as running a public data feed. Price of it:

- **AI spend.** Every `/ask` and `/briefing` costs OpenRouter budget, and
  anyone can trigger them.
- **Signal poisoning.** Anyone can push fake fills into `/ingest` and skew
  convergence. There is no per-source trust on ingest.
- **No write damage possible.** The brain cannot trade: it holds no exchange
  keys and has no order path. The worst case is a corrupted feed and a
  surprising LLM bill — both visible immediately in logs and calls.

## If you want keys back

Set `API_SECRET` (gates `/ask`, `/briefing`, `/plans`, `/close`, `/mcp`)
and `INGEST_SECRET` (gates `/ingest/*`) in the box `.env` and recreate the
container. Empty value = open; the code supports both modes, no rebuild
needed for the switch itself.

## Still true with or without keys

- `/calls/active`, `/stats`, `/health` are always open (the UI needs them).
- The AWS box holds no trading credentials in any mode — signal-only means
  there is nothing to steal that can move money.
- CORS is open (`*`) so any page can read the public feed.
