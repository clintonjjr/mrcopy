import { PARAMS } from "../config/params.js";
import type { TradeCall } from "./callBus.js";

/** Minimal Telegram pings — only when something real happens. */
export class Notifier {
  private async send(text: string) {
    if (!PARAMS.TELEGRAM_BOT_TOKEN || !PARAMS.TELEGRAM_CHAT_ID) return;
    try {
      await fetch(`https://api.telegram.org/bot${PARAMS.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: PARAMS.TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }),
      });
    } catch (e) {
      console.error("[TG] send failed:", (e as Error).message);
    }
  }

  notifyCall(c: TradeCall) {
    return this.send(
      [
        `⚡ *MRCOPY #${c.id} — ${c.direction} ${c.coin}* (${c.binance_symbol || "pre-Binance"})`,
        ``,
        `Conviction ${c.conviction}/100 · lev x${c.leverage_suggested} · ${c.venues.join("+")}`,
        `Entry: ${c.entry_hint} · SL ${c.stop_hint} · TPs ${c.tp_hints.join(" / ")}`,
        `Wallets: ${c.wallets.map((w) => w.slice(0, 6) + "…" + w.slice(-4)).join(", ")}`,
        c.pre_binance_alpha ? `🅰️ *PRE-BINANCE ALPHA* — execution agent waits for listing` : ``,
        `Invalidation: ${c.invalidation}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  notifyExit(callId: number, coin: string, reason: string) {
    return this.send(`🚪 *EXIT #${callId} ${coin}* — ${reason}\nExecution agent: close/reduce on Binance.`);
  }

  notifySkip(coin: string, reason: string) {
    console.log(`[Skip] ${coin}: ${reason}`);
  }
}
