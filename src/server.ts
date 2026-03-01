import { config } from "./config";
import { db } from "./db";
import { ingest } from "./ingestion/orchestrator";
import { type ErrorPayload, HttpError, errorResponse, toErrorPayload, unknownErrorResponse } from "./http/errors";
import { parseLegacySearchParams, parseSuggestParams, parseV1SearchParams } from "./http/validation";
import { log, logRequest } from "./logging";
import {
  recordRateLimitRejection,
  recordSearchLatency,
  recordSearchRequest,
  renderPrometheusMetrics,
} from "./metrics";
import { getOpenApiSpec } from "./openapi";
import { recordQuery } from "./queryLog";
import { TokenBucketRateLimiter } from "./rateLimit/tokenBucket";
import { search, searchV1, suggest } from "./search";
import type { SuggestionResponse } from "./types/api";

const rateLimiter = new TokenBucketRateLimiter(
  config.RATE_LIMIT_CAPACITY,
  config.RATE_LIMIT_REFILL_PER_SEC
);

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

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return true;
  }

  if (config.CORS_ALLOW_ORIGIN_LIST.includes("*")) {
    return true;
  }

  return config.CORS_ALLOW_ORIGIN_LIST.includes(origin);
}

function applyCorsHeaders(req: Request, headers: Headers): void {
  const origin = req.headers.get("origin");
  if (config.CORS_ALLOW_ORIGIN_LIST.includes("*")) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && config.CORS_ALLOW_ORIGIN_LIST.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,x-api-key");
}

function withCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  applyCorsHeaders(req, headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonWithCors(req: Request, body: unknown, status = 200): Response {
  return withCors(req, Response.json(body, { status }));
}

function checkApiKey(pathname: string, req: Request): void {
  if (!config.API_KEY_ENABLED) {
    return;
  }

  if (!pathname.startsWith("/v1/")) {
    return;
  }

  const key = req.headers.get("x-api-key");
  if (!key || key !== config.API_KEY_VALUE) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid API key");
  }
}

function ensureCorsAllowed(req: Request): void {
  const origin = req.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    throw new HttpError(403, "CORS_FORBIDDEN", "Origin is not allowed", { origin });
  }
}

function validateRateLimit(ip: string): void {
  const allowed = rateLimiter.consume(ip);
  if (!allowed) {
    recordRateLimitRejection();
    throw new HttpError(429, "RATE_LIMITED", "Rate limit exceeded");
  }
}

function createNotFound(requestId: string): ErrorPayload {
  return toErrorPayload(requestId, "NOT_FOUND", "Not Found");
}

export function startServer(port = config.PORT) {
  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const requestId = crypto.randomUUID();
      const startedAt = performance.now();
      const url = new URL(req.url);
      const path = url.pathname;
      const ip = getClientIp(req);

      let status = 200;
      let response: Response;

      try {
        ensureCorsAllowed(req);

        if (req.method === "OPTIONS") {
          response = withCors(req, new Response(null, { status: 204 }));
          status = response.status;
          return response;
        }

        checkApiKey(path, req);

        if (path === "/health") {
          response = jsonWithCors(req, { status: "ok", requestId });
          status = response.status;
          return response;
        }

        if (path === "/ready") {
          const readinessStmt = db.query<{ ok: number }, []>("SELECT 1 as ok");
          const ok = readinessStmt.get()?.ok === 1;
          if (!ok) {
            response = withCors(
              req,
              errorResponse(requestId, 503, "NOT_READY", "Service is not ready")
            );
            status = response.status;
            return response;
          }

          response = jsonWithCors(req, { status: "ready", requestId });
          status = response.status;
          return response;
        }

        if (path === "/metrics") {
          response = withCors(
            req,
            new Response(renderPrometheusMetrics(), {
              status: 200,
              headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
            })
          );
          status = response.status;
          return response;
        }

        if (path === "/openapi.json") {
          response = jsonWithCors(req, getOpenApiSpec());
          status = response.status;
          return response;
        }

        if (path === "/v1/suggest") {
          validateRateLimit(ip);
          const parsed = parseSuggestParams(url.searchParams);
          const suggestions = await suggest(parsed.query, parsed.limit);
          const payload: SuggestionResponse = {
            query: parsed.query,
            suggestions,
          };
          response = jsonWithCors(req, payload);
          status = response.status;
          recordSearchRequest(path, status);
          return response;
        }

        if (path === "/v1/search") {
          validateRateLimit(ip);
          const parsed = parseV1SearchParams(url.searchParams);
          const { isNew } = recordQuery(parsed.query);
          if (isNew) {
            void ingest(parsed.query).catch((error) => {
              log("error", "ingestion.background.failed", {
                requestId,
                query: parsed.query,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }

          const envelope = await searchV1(parsed);
          response = jsonWithCors(req, envelope);
          status = response.status;
          recordSearchRequest(path, status);
          return response;
        }

        if (path === "/search") {
          validateRateLimit(ip);
          const parsed = parseLegacySearchParams(url.searchParams);
          const offset = (parsed.page - 1) * parsed.limit;

          const { isNew } = recordQuery(parsed.query);
          if (isNew) {
            void ingest(parsed.query).catch((error) => {
              log("error", "ingestion.background.failed", {
                requestId,
                query: parsed.query,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }

          const results = await search(parsed.query, parsed.limit, offset);
          response = jsonWithCors(req, results);
          status = response.status;
          recordSearchRequest(path, status);
          return response;
        }

        response = jsonWithCors(req, createNotFound(requestId), 404);
        status = 404;
        return response;
      } catch (error) {
        if (error instanceof HttpError) {
          response = withCors(
            req,
            errorResponse(
              requestId,
              error.status,
              error.code,
              error.message,
              error.details
            )
          );
          status = error.status;
          if (path === "/search" || path.startsWith("/v1/")) {
            recordSearchRequest(path, status);
          }
          return response;
        }

        log("error", "http.unhandled", {
          requestId,
          path,
          error: error instanceof Error ? error.message : String(error),
        });
        response = withCors(req, unknownErrorResponse(requestId));
        status = 500;
        if (path === "/search" || path.startsWith("/v1/")) {
          recordSearchRequest(path, status);
        }
        return response;
      } finally {
        const latencyMs = performance.now() - startedAt;
        if (path === "/search" || path.startsWith("/v1/")) {
          recordSearchLatency(path, latencyMs);
        }
        logRequest({
          requestId,
          method: req.method,
          path,
          status,
          latencyMs: Number(latencyMs.toFixed(2)),
          ip,
        });
      }
    },
  });

  log("info", "server.started", { port: server.port });
  return server;
}
