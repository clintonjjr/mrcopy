import { EventEmitter } from "node:events";
import { PARAMS } from "../config/params.js";
import { getPool } from "../data/wallets.js";
import { FillDedupe } from "../data/db.js";

export interface LeaderEvent {
  venue: string; // hyperliquid | aster | lighter | paradex | backpack | edgeX | custom…
  wallet: string;
  coin: string; // e.g. BTC, HYPE, ASTER
  direction: "LONG" | "SHORT" | "CLOSE" | "FLIP";
  sizeHint: number; // notional USD estimate when available
  entryPx?: number;
  leverage?: number;
  txHash?: string;
  timestamp: number;
}

interface HLPosition {
  coin: string;
  szi: string;
  entryPx?: string;
  positionValue?: string;
  leverage?: { value: number };
}

/**
 * Hyperliquid tracker — fully public, no API key needed.
 * Polls `clearinghouseState` (open positions) for position diffs and
 * `userFills` (recent fills) for fresh flow. This is the primary lead
 * venue because every perp trade is on-chain and visible in real time.
 */
export class HyperliquidTracker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private lastPositions = new Map<string, Map<string, number>>(); // wallet -> coin -> signed size
  private running = false;

  count() {
    return getPool().length;
  }

  start() {
    if (this.running) return;
    if (getPool().length === 0) {
      console.warn("[HL] pool empty — discovery refills it from the leaderboard automatically");
    }
    this.running = true;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), PARAMS.HL_POLL_MS);
    console.log(`[HL] polling pool every ${PARAMS.HL_POLL_MS}ms`);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  private async poll() {
    for (const wallet of getPool()) {
      try {
        await this.pollWallet(wallet);
      } catch (e) {
        console.error(`[HL] poll failed for ${wallet.slice(0, 10)}…:`, (e as Error).message);
      }
    }
  }

  private async info<T>(body: unknown): Promise<T> {
    const res = await fetch(`${PARAMS.HL_INFO_URL}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HL info ${res.status}`);
    return (await res.json()) as T;
  }

  private async pollWallet(wallet: string) {
    // 1) Open positions snapshot -> diff vs last snapshot
    const state = await this.info<{ assetPositions?: { position: HLPosition }[] }>({
      type: "clearinghouseState",
      user: wallet,
    });
    const now = new Map<string, number>();
    for (const ap of state.assetPositions ?? []) {
      const p = ap.position;
      const szi = parseFloat(p.szi ?? "0");
      if (!Number.isFinite(szi) || szi === 0) continue;
      now.set(p.coin, szi);
      const prev = this.lastPositions.get(wallet)?.get(p.coin) ?? 0;
      // New position or flip or meaningful add (>25% size change crossing from flat counts as new)
      if (prev === 0) {
        this.emitEvent({
          venue: "hyperliquid",
          wallet,
          coin: p.coin,
          direction: szi > 0 ? "LONG" : "SHORT",
          sizeHint: Math.abs(parseFloat(p.positionValue ?? "0")),
          entryPx: p.entryPx ? parseFloat(p.entryPx) : undefined,
          leverage: p.leverage?.value,
          timestamp: Date.now(),
        });
      } else if (Math.sign(prev) !== Math.sign(szi)) {
        this.emitEvent({
          venue: "hyperliquid",
          wallet,
          coin: p.coin,
          direction: "FLIP",
          sizeHint: Math.abs(parseFloat(p.positionValue ?? "0")),
          timestamp: Date.now(),
        });
        this.emitEvent({
          venue: "hyperliquid",
          wallet,
          coin: p.coin,
          direction: szi > 0 ? "LONG" : "SHORT",
          sizeHint: Math.abs(parseFloat(p.positionValue ?? "0")),
          timestamp: Date.now(),
        });
      }
    }
    // Closed positions: in prev but not in now
    const prev = this.lastPositions.get(wallet) ?? new Map();
    for (const [coin] of prev) {
      if (!now.has(coin)) {
        this.emitEvent({ venue: "hyperliquid", wallet, coin, direction: "CLOSE", sizeHint: 0, timestamp: Date.now() });
      }
    }
    this.lastPositions.set(wallet, now);

    // 2) Fresh fills -> directional flow (catches fast scalps that open+close between polls)
    const fills = await this.info<
      { coin: string; side: string; px: string; sz: string; time: number; hash: string; dir: string }[]
    >({ type: "userFillsByTime", user: wallet, startTime: Date.now() - PARAMS.HL_POLL_MS * 3 });
    const list = Array.isArray(fills) ? fills : [];
    for (const f of list.slice(-20)) {
      const key = `hl:${f.hash}:${f.time}:${f.coin}:${f.sz}`;
      if (FillDedupe.seen(key)) continue;
      FillDedupe.mark(key);
      // dir examples: "Open Long" | "Open Short" | "Close Long" | "Close Short"
      const d = (f.dir ?? "").toLowerCase();
      let direction: LeaderEvent["direction"] | null = null;
      if (d.includes("open long")) direction = "LONG";
      else if (d.includes("open short")) direction = "SHORT";
      else if (d.includes("close")) direction = "CLOSE";
      if (!direction) continue;
      this.emitEvent({
        venue: "hyperliquid",
        wallet,
        coin: f.coin,
        direction,
        sizeHint: parseFloat(f.px) * parseFloat(f.sz),
        entryPx: parseFloat(f.px),
        txHash: f.hash,
        timestamp: f.time,
      });
    }
  }

  snapshot(wallet: string): Map<string, number> {
    return this.lastPositions.get(wallet) ?? new Map();
  }

  private emitEvent(e: LeaderEvent) {
    if (e.direction === "CLOSE" || e.direction === "FLIP") {
      console.log(`[HL] ${e.wallet.slice(0, 8)}… ${e.direction} ${e.coin}`);
    } else {
      console.log(
        `[HL] ${e.wallet.slice(0, 8)}… → ${e.direction} ${e.coin} (~$${Math.round(e.sizeHint).toLocaleString()})`
      );
    }
    this.emit("leader", e);
  }
}
