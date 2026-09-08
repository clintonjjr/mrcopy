import { PARAMS } from "../config/params.js";

export interface BinanceMarket {
  symbol: string;
  listed: boolean;
  markPrice?: number;
  fundingRate?: number;
  volume24h?: number;
}

/**
 * Binance LEG tracker — public REST only, no keys.
 * Role: confirm the Binance side of every call.
 *  - Is the coin listed as a USDT-M perp? (else: pre-Binance alpha flag)
 *  - Funding crowded? Volume sufficient? (lag confirmation: Binance behind Aster/HL)
 */
export class BinanceLegTracker {
  private perpSymbols = new Set<string>();
  private loadedAt = 0;

  private async ensureSymbols() {
    if (Date.now() - this.loadedAt < 10 * 60_000 && this.perpSymbols.size) return;
    const res = await fetch(`${PARAMS.BINANCE_FAPI_URL}/fapi/v1/exchangeInfo`);
    if (!res.ok) throw new Error(`binance exchangeInfo ${res.status}`);
    const j = (await res.json()) as { symbols: { symbol: string; status: string; contractType: string }[] };
    this.perpSymbols = new Set(
      j.symbols.filter((s) => s.status === "TRADING" && s.contractType === "PERPETUAL").map((s) => s.symbol)
    );
    this.loadedAt = Date.now();
  }

  async check(binanceSymbol: string): Promise<BinanceMarket> {
    if (!binanceSymbol) return { symbol: "", listed: false };
    await this.ensureSymbols();
    const listed = this.perpSymbols.has(binanceSymbol.toUpperCase());
    if (!listed) return { symbol: binanceSymbol, listed: false };
    try {
      const [prem, tick] = await Promise.all([
        fetch(`${PARAMS.BINANCE_FAPI_URL}/fapi/v1/premiumIndex?symbol=${binanceSymbol}`).then((r) => r.json()),
        fetch(`${PARAMS.BINANCE_FAPI_URL}/fapi/v1/ticker/24hr?symbol=${binanceSymbol}`).then((r) => r.json()),
      ]);
      return {
        symbol: binanceSymbol,
        listed: true,
        markPrice: parseFloat((prem as { markPrice: string }).markPrice),
        fundingRate: parseFloat((prem as { lastFundingRate: string }).lastFundingRate),
        volume24h: parseFloat((tick as { quoteVolume: string }).quoteVolume),
      };
    } catch {
      return { symbol: binanceSymbol, listed: true };
    }
  }
}
