import { ingest } from "./ingestion/orchestrator";
import { recordQuery } from "./queryLog";
import { search } from "./search";

const requestLog = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return req.headers.get("host") ?? "local";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = requestLog.get(ip);

  if (!record) {
    requestLog.set(ip, { count: 1, lastReset: now });
    return false;
  }

  if (now - record.lastReset > WINDOW_MS) {
    record.count = 1;
    record.lastReset = now;
    return false;
  }

  record.count += 1;
  return record.count > RATE_LIMIT;
}

export function startServer(port = 3000) {
  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // ADD THIS NEW /EXIT ROUTE
      if (url.pathname === "/exit") {
        console.log("Received exit command. Shutting down...");
        stopScheduler(); // Stop the background tasks
        setTimeout(() => server.stop(), 100); // Stop the server after responding
        return new Response("Server shutting down gracefully...", { status: 200 });
      }

      if (url.pathname !== "/search") {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const clientIp = getClientIp(req);
        if (isRateLimited(clientIp)) {
          return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
        }

        const q = url.searchParams.get("q")?.trim();
        if (!q) {
          return Response.json([]);
        }

        // ADD PAGINATION PARSING HERE
        const page = parseInt(url.searchParams.get("page") || "1", 10);
        const limit = parseInt(url.searchParams.get("limit") || "10", 10);
        const offset = (page - 1) * limit;

        const { isNew } = recordQuery(q);
        if (isNew) {
          void ingest(q).catch((error) => {
            console.error(`Background ingestion failed for "${q}":`, error);
          });
        }

        // PASS LIMIT AND OFFSET TO SEARCH
        const results = await search(q, limit, offset);

        // Return pagination metadata along with results
        return Response.json({
          page,
          limit,
          results
        });
      } catch (error) {
        console.error("Search request failed:", error);
        return Response.json({ error: "Internal server error" }, { status: 500 });
      }
    },
  });

  console.log(`Server running on http://localhost:${port}`);
  return server;
}
