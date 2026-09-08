import "dotenv/config";
import { Orchestrator } from "./core/orchestrator.js";
import { createServer } from "./agents/webhookServer.js";
import { loadSoul } from "./brain/soul.js";
import { PARAMS } from "./config/params.js";

const soul = loadSoul(); // the brain refuses to boot soulless
const orch = new Orchestrator();
await orch.start();

const app = createServer(orch.aster, orch.learning, { ...orch.brainDeps(), soul });
app.listen(PARAMS.PORT, () => {
  console.log(`[REST] listening on :${PARAMS.PORT} — UI at /, calls at GET /calls/active`);
  console.log(`[REST] brain at POST /ask, GET /briefing · MCP at /mcp`);
  console.log(`[REST] auth: ${PARAMS.API_SECRET ? "API_SECRET enforced" : "OPEN (set API_SECRET on AWS!)"}`);
});

const shutdown = () => {
  orch.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
