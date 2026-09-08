import type { Express, Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PARAMS } from "../config/params.js";
import { buildMcpServer, type McpDeps } from "./mcpServer.js";

/**
 * MCP over Streamable HTTP for the AWS instance: remote agents connect to
 * https://<host>:8787/mcp with `Authorization: Bearer <API_SECRET>`.
 * Local stdio (`npm run mcp`) keeps working for same-machine agents.
 */
export function mountMcpHttp(app: Express, deps: McpDeps) {
  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (!PARAMS.API_SECRET) return next(); // open only when no secret configured
    const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (got !== PARAMS.API_SECRET) return void res.status(401).json({ error: "unauthorized" });
    next();
  };

  const handle = async (req: Request, res: Response) => {
    const server = buildMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close().catch(() => undefined));
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: (e as Error).message });
    }
  };

  app.post("/mcp", guard, handle);
  app.get("/mcp", guard, handle);
  app.delete("/mcp", guard, handle);
}
