import "dotenv/config";
import { BinanceLegTracker } from "./agents/binanceLegTracker.js";
import { Protections, DEFAULT_RISK } from "./strategies/risk.js";
import { loadSoul } from "./brain/soul.js";
import { startMcpStandalone } from "./agents/mcpServer.js";

// Standalone MCP entry: `npm run mcp` — connect this alongside the Binance
// MCP server in Claude/ChatGPT/Codex/Cursor.
await startMcpStandalone(new BinanceLegTracker(), new Protections(DEFAULT_RISK));
