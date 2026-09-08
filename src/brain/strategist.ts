import { PARAMS } from "../config/params.js";
import { type BrainContext, contextToPrompt } from "./context.js";
import type { Setup } from "../strategies/lifecycle.js";

export interface Answer {
  text: string;
  setups?: Setup[];
  provider: "llm" | "rules";
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const base = PARAMS.LLM_BASE_URL || "https://api.anthropic.com";
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": PARAMS.LLM_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: PARAMS.LLM_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { content: { type: string; text?: string }[] };
  return j.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
}

async function callOpenAI(system: string, user: string): Promise<string> {
  const base = PARAMS.LLM_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PARAMS.LLM_API_KEY}` },
    body: JSON.stringify({
      model: PARAMS.LLM_MODEL,
      max_tokens: 1200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  return j.choices[0]?.message?.content ?? "";
}

function llmReady(): boolean {
  return PARAMS.LLM_PROVIDER !== "none" && !!PARAMS.LLM_API_KEY && !!PARAMS.LLM_MODEL;
}

/** Rule-based fallback: real numbers from context, soul voice, no model needed. */
function detectCoin(q: string, ctx: BrainContext): string | null {
  const known = new Set<string>();
  for (const l of ctx.leaders as { coin: string }[]) known.add(l.coin.toUpperCase());
  for (const c of ctx.calls) {
    known.add(c.coin.toUpperCase());
    if (c.binance_symbol) known.add(c.binance_symbol.replace(/USDT$/, "").toUpperCase());
  }
  for (const m of ctx.market) {
    if (m.symbol) known.add(m.symbol.replace(/USDT$/, "").toUpperCase());
  }
  const toks = q.toUpperCase().match(/\b[A-Z]{2,12}\b/g) ?? [];
  for (const t of toks) {
    const coin = t.replace(/USDT$/, "");
    if (known.has(coin)) return coin;
  }
  return null;
}

/** "Who's trading SOL and what's the setup" — per-coin leader intel. */
function coinAnswer(coin: string, ctx: BrainContext, setups?: Setup[]): string {
  const L: string[] = [];
  const leaders = (ctx.leaders as {
    coin: string; wallets: string[]; walletCount: number; dominantSide: string;
    avgTenureMin: number; maxTenureMin: number; notional: number;
  }[]).filter((l) => l.coin.toUpperCase() === coin);
  const calls = ctx.calls.filter((c) => c.coin.toUpperCase() === coin);
  const mine = (setups ?? []).filter((s) => s.coin.toUpperCase() === coin);
  if (!leaders.length && !calls.length) {
    const alt = (ctx.leaders as { coin: string }[]).slice(0, 5).map((l) => l.coin).join(", ");
    return `${coin}: not on the radar in the last 24h.${alt ? ` Flowing now: ${alt}.` : " Tracker is listening."}`;
  }
  L.push(`${coin} — smart-trader picture:`);
  for (const l of leaders) {
    L.push(`• ${l.walletCount} wallets ${l.dominantSide}, avg tenure ${l.avgTenureMin}m (max ${l.maxTenureMin}m), ~$${l.notional.toLocaleString()} flow.`);
  }
  for (const d of ctx.leaderDetail.filter((x) => x.coin.toUpperCase() === coin).slice(0, 8)) {
    L.push(`  ${d.wallet.slice(0, 10)}… trust ${d.trust} · in ${d.tenureMin ?? "?"}m · adds ${d.adds} · last ${d.lastSide}`);
  }
  for (const c of calls) {
    L.push(`• Active call #${c.id}: ${c.direction} conv ${c.conviction}, entry ${c.entry_hint}, SL ${c.stop_hint}.`);
  }
  if (mine.length) {
    for (const s of mine) {
      L.push(`• Setup: ${s.direction} via ${s.executor}, conv ${s.conviction}, stop ${s.stopPct}%, TPs ${s.tpLadder.map((t) => `+${t.tpPct}%`).join("/")}. Invalidation: leaders close/flip or stop.`);
    }
  } else if (!calls.length) {
    L.push("No gated setup right now — flow without an entry edge. Watching.");
  }
  const mkt = ctx.market.find((m) => m.symbol.replace(/USDT$/, "").toUpperCase() === coin);
  if (mkt?.fundingRate !== undefined && Math.abs(mkt.fundingRate) > 0.001) {
    L.push(`Funding crowded (${mkt.fundingRate}) — size down or take the paid side.`);
  }
  return L.join("\n");
}

function fallbackAnswer(question: string, ctx: BrainContext, setups?: Setup[]): string {
  const q = question.toLowerCase();
  const wantsToday = /today|enter|watchlist|brief|setup|play/.test(q);
  const L: string[] = [];
  if (!ctx.risk.ok) {
    return `HALTED — ${ctx.risk.reason} (day ${ctx.risk.dayPnlPct}%). No fresh setups. Flat is the position. (rule-based; set LLM_* for full analysis)`;
  }
  const coin = detectCoin(q, ctx);
  if (coin) return coinAnswer(coin, ctx, setups) + "\n(rule-based intel; set LLM_PROVIDER + key for narrative analysis)";
  if (wantsToday) {
    if (!setups?.length) {
      L.push("FLAT today — nothing passes the gate.");
      if (ctx.leaders.length) {
        const l = ctx.leaders[0] as { coin: string; walletCount: number; dominantSide: string; avgTenureMin: number };
        L.push(`Closest: ${l.coin} — ${l.walletCount} wallets ${l.dominantSide}, avg tenure ${l.avgTenureMin}m. Watching for confirmation.`);
      } else L.push("No leader flow in the last 24h. Tracker is listening.");
    } else {
      L.push(`Today's board — ${setups.length} setup${setups.length > 1 ? "s" : ""}:`);
      for (const s of setups) {
        L.push(`• ${s.direction} ${s.coin} (${s.symbol}) via ${s.executor} — conviction ${s.conviction}. Entry: ${(s.entry as { kind?: string }).kind ?? "grid"}; stop ${s.stopPct}%; TPs ${s.tpLadder.map((t) => `+${t.tpPct}%`).join("/")}. Why: ${s.reasons.slice(0, 3).join(", ")}.`);
      }
    }
    L.push("(rule-based briefing; set LLM_PROVIDER + key for narrative analysis)");
    return L.join("\n");
  }
  // general status question
  L.push(`Risk ${ctx.risk.ok ? "CLEAR" : "HALTED"} · ${ctx.calls.length} active calls · day ${ctx.risk.dayPnlPct}%.`);
  const top = (ctx.leaders as { coin: string; walletCount: number; dominantSide: string; avgTenureMin: number }[]).slice(0, 3);
  if (top.length) L.push("Leader flow: " + top.map((l) => `${l.coin} ${l.dominantSide} x${l.walletCount} (${l.avgTenureMin}m avg)`).join(" | "));
  else L.push("No leader flow in window.");
  const crowded = ctx.market.filter((m) => m.fundingRate !== undefined && Math.abs(m.fundingRate) > 0.001);
  if (crowded.length) L.push("Crowded funding: " + crowded.map((m) => `${m.symbol} ${m.fundingRate}`).join(", ") + " — size down or harvest.");
  L.push("Ask 'what can I enter today' for the ranked board.");
  return L.join("\n");
}

export async function answer(
  question: string,
  ctx: BrainContext,
  soul: string,
  setups?: Setup[]
): Promise<Answer> {
  const prompt = `${contextToPrompt(ctx)}\n\nquestion: ${question}\n${
    setups?.length ? "ranked-setups:\n" + setups.map((s) => `- ${s.direction} ${s.coin} via ${s.executor} conv ${s.conviction} [${s.reasons.join(", ")}]`).join("\n") : ""
  }`;
  if (!llmReady()) {
    return { text: fallbackAnswer(question, ctx, setups), setups, provider: "rules" };
  }
  try {
    const text =
      PARAMS.LLM_PROVIDER === "anthropic" ? await callAnthropic(soul, prompt) : await callOpenAI(soul, prompt);
    return { text, setups, provider: "llm" };
  } catch (e) {
    return {
      text: fallbackAnswer(question, ctx, setups) + `\n(llm error, fell back: ${(e as Error).message})`,
      setups,
      provider: "rules",
    };
  }
}
