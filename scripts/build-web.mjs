// Bakes the brain's public URL into the landing page for Vercel.
// MRCOPY_API=https://<tunnel> node scripts/build-web.mjs  (empty = same-origin)
import fs from "node:fs";

const api = (process.env.MRCOPY_API ?? "").replace(/\/$/, "");
const TAG = '<meta name="mrcopy-api" content="">';
const src = fs.readFileSync("web/index.html", "utf8");
if (!src.includes(TAG)) throw new Error("api meta tag missing in web/index.html");
const out = src.split(TAG).join(`<meta name="mrcopy-api" content="${api}">`);
fs.mkdirSync("dist-web", { recursive: true });
fs.writeFileSync("dist-web/index.html", out);
console.log(`[web] built with API base: ${api || "(same-origin)"}`);
