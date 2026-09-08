import fs from "node:fs";
import path from "node:path";
import { PARAMS } from "../config/params.js";

let cached: string | null = null;

/**
 * The soul is the brain's system prompt — and the ONLY place its judgment
 * comes from. Loaded from disk at startup so editing SOUL.md changes the
 * strategist with no code deploy.
 */
export function loadSoul(): string {
  if (cached) return cached;
  const candidates = [
    PARAMS.SOUL_PATH,
    path.resolve("src/soul/SOUL.md"),
    path.resolve("dist/soul/SOUL.md"),
    new URL("../soul/SOUL.md", import.meta.url).pathname,
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cached = fs.readFileSync(p, "utf8");
        console.log(`[Soul] loaded ${cached.length} chars from ${p}`);
        return cached;
      }
    } catch { /* try next */ }
  }
  throw new Error("SOUL.md not found — the brain refuses to run soulless");
}
