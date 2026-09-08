// Central tunables. Mirrors the memecoin agent's params.ts philosophy,
// retuned for perps: slower windows, conviction instead of SOL sizing,
// exits driven by leaders closing/flipping + time stops.
export const PARAMS = {
  HL_INFO_URL: process.env.HL_INFO_URL ?? "https://api.hyperliquid.xyz",
  HL_POLL_MS: Number(process.env.HL_POLL_MS ?? 20_000),
  ASTER_FAPI_URL: process.env.ASTER_FAPI_URL ?? "https://fapi.asterdex.com",
  BINANCE_FAPI_URL: process.env.BINANCE_FAPI_URL ?? "https://fapi.binance.com",
  INGEST_SECRET: process.env.INGEST_SECRET ?? "",

  MIN_WALLETS_FOR_SIGNAL: Number(process.env.MIN_WALLETS_FOR_SIGNAL ?? 2),
  SIGNAL_WINDOW_SECONDS: Number(process.env.SIGNAL_WINDOW_SECONDS ?? 600),
  MIN_CONVICTION: Number(process.env.MIN_CONVICTION ?? 60),
  ALLOW_PRE_BINANCE_ALPHA: (process.env.ALLOW_PRE_BINANCE_ALPHA ?? "true") === "true",

  CALL_TTL_HOURS: Number(process.env.CALL_TTL_HOURS ?? 24),
  EXIT_ON_LEADERS_CLOSED: Number(process.env.EXIT_ON_LEADERS_CLOSED ?? 2),

  EXECUTION_WEBHOOK_URL: process.env.EXECUTION_WEBHOOK_URL ?? "",
  EXECUTION_WEBHOOK_SECRET: process.env.EXECUTION_WEBHOOK_SECRET ?? "",
  PORT: Number(process.env.PORT ?? 8787),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID ?? "",
  DB_PATH: process.env.DB_PATH ?? "./data/calls.db",
  DRY_RUN: (process.env.DRY_RUN ?? "true") !== "false",

  // ── Brain (LLM strategist; "none" = rule-based fallback, still useful) ──
  LLM_PROVIDER: process.env.LLM_PROVIDER ?? "none", // none | anthropic | openai
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LLM_MODEL: process.env.LLM_MODEL ?? "",
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? "", // default per provider
  SOUL_PATH: process.env.SOUL_PATH ?? "",
  BRIEFING_TTL_HOURS: Number(process.env.BRIEFING_TTL_HOURS ?? 6),

  // ── Risk ──
  RISK_COOLDOWN_MIN: Number(process.env.RISK_COOLDOWN_MIN ?? 60),
  RISK_MAX_STOPS: Number(process.env.RISK_MAX_STOPS ?? 3),
  RISK_HALT_MIN: Number(process.env.RISK_HALT_MIN ?? 240),
  RISK_MAX_DAY_DD_PCT: Number(process.env.RISK_MAX_DAY_DD_PCT ?? 6),

  // ── Discovery (no hardcoded wallets — the desk finds its own) ──
  HL_STATS_URL: process.env.HL_STATS_URL ?? "https://stats-data.hyperliquid.xyz",
  ASTERSCAN_URL: process.env.ASTERSCAN_URL ?? "https://aster-scan.com/api/public/v1",
  DISCOVERY_EVERY_MIN: Number(process.env.DISCOVERY_EVERY_MIN ?? 60),
  DISCOVERY_TOP: Number(process.env.DISCOVERY_TOP ?? 40),
  DISCOVERY_MIN_EQUITY: Number(process.env.DISCOVERY_MIN_EQUITY ?? 10000),
  POOL_MAX: Number(process.env.POOL_MAX ?? 60),

  // ── Access (AWS: set this; REST + MCP require it when set) ──
  API_SECRET: process.env.API_SECRET ?? "",

  // Served counter starts here; every call from every agent adds up.
  CALL_COUNT_BASE: Number(process.env.CALL_COUNT_BASE ?? 1000),

  // CORS for the split deploy (Vercel landing -> Mac brain).
  // Comma list, or "*" to allow any origin (reads are public anyway).
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? "",
};

export const TRACKED_WALLETS: string[] = (process.env.TRACKED_WALLETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s));

/** Served-calls counter seed — the count all connected agents share starts here. */
export const CALL_COUNT_BASE: number = PARAMS.CALL_COUNT_BASE;

/** Hyperliquid coin -> Binance USDT-M symbol. Extend as new perps appear. */
export function toBinanceSymbol(coin: string): string {
  const clean = coin.replace(/^\d+@/, "").toUpperCase(); // HL spot "@107" style
  if (clean.endsWith("USDT")) return clean;
  if (clean === "USDC" || clean === "USD") return "";
  return `${clean}USDT`;
}
