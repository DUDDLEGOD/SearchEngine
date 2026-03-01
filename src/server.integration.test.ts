import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { config } from "./config";
import { db } from "./db";
import { indexDocumentBatch } from "./indexDocumentBatch";
import type { IngestedDocument } from "./ingestion/types";
import { initDb } from "./initDb";
import { recordQuery } from "./queryLog";
import { startServer } from "./server";

const docs: IngestedDocument[] = [
  {
    url: "https://integration.test/search",
    title: "Search Engine Intro",
    content: "Search engines retrieve and rank relevant web pages.",
    source: "wikipedia",
    publishedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    url: "https://integration.test/learning",
    title: "Machine Learning Intro",
    content: "Machine learning techniques improve retrieval quality.",
    source: "hn",
    publishedAt: "2026-01-15T00:00:00.000Z",
  },
];

function resetDatabase() {
  db.exec(`
    DROP TABLE IF EXISTS term_positions;
    DROP TABLE IF EXISTS inverted_index;
    DROP TABLE IF EXISTS terms;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS queries;
    DROP TABLE IF EXISTS schema_migrations;
  `);
  initDb();
}

describe("server integration", () => {
  const port = 4600 + Math.floor(Math.random() * 200);
  const baseUrl = `http://localhost:${port}`;
  const mutableConfig = config as unknown as {
    API_KEY_ENABLED: boolean;
    API_KEY_VALUE: string;
    CORS_ALLOW_ORIGIN_LIST: string[];
  };

  let server: ReturnType<typeof startServer>;
  let originalApiKeyEnabled = false;
  let originalApiKeyValue = "";
  let originalCors: string[] = [];

  beforeAll(async () => {
    originalApiKeyEnabled = mutableConfig.API_KEY_ENABLED;
    originalApiKeyValue = mutableConfig.API_KEY_VALUE;
    originalCors = [...mutableConfig.CORS_ALLOW_ORIGIN_LIST];

    resetDatabase();
    await indexDocumentBatch(docs, { force: true });

    recordQuery("search engine");
    recordQuery("machine learning");

    server = startServer(port);
  });

  beforeEach(() => {
    mutableConfig.API_KEY_ENABLED = false;
    mutableConfig.API_KEY_VALUE = "";
    mutableConfig.CORS_ALLOW_ORIGIN_LIST = [...originalCors];
  });

  afterAll(() => {
    mutableConfig.API_KEY_ENABLED = originalApiKeyEnabled;
    mutableConfig.API_KEY_VALUE = originalApiKeyValue;
    mutableConfig.CORS_ALLOW_ORIGIN_LIST = [...originalCors];
    server.stop();
  });

  test("health and ready endpoints work", async () => {
    const health = await fetch(`${baseUrl}/health`);
    const ready = await fetch(`${baseUrl}/ready`);

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
  });

  test("legacy /search returns legacy array shape", async () => {
    const response = await fetch(`${baseUrl}/search?q=search%20engine`, {
      headers: { "x-forwarded-for": "10.0.0.10" },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as Array<{ title: string; url: string; score: number }>;
    expect(Array.isArray(data)).toBe(true);
    const first = data[0];
    if (first) {
      expect(typeof first.title).toBe("string");
      expect(typeof first.score).toBe("number");
    }
  });

  test("v1 search returns envelope", async () => {
    const response = await fetch(`${baseUrl}/v1/search?q=search%20engine&page=1&limit=5`, {
      headers: { "x-forwarded-for": "10.0.0.11" },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      query: string;
      total: number;
      results: Array<{ snippet: string; highlights: string[] }>;
    };
    expect(data.query).toBe("search engine");
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("suggest endpoint returns suggestions", async () => {
    const response = await fetch(`${baseUrl}/v1/suggest?q=sear&limit=5`, {
      headers: { "x-forwarded-for": "10.0.0.12" },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { suggestions: string[] };
    expect(Array.isArray(data.suggestions)).toBe(true);
  });

  test("metrics endpoint exposes prometheus format", async () => {
    await fetch(`${baseUrl}/search?q=search%20engine`, {
      headers: { "x-forwarded-for": "10.0.0.13" },
    });
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body.includes("search_requests_total")).toBe(true);
  });

  test("openapi endpoint is available", async () => {
    const response = await fetch(`${baseUrl}/openapi.json`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(data.openapi).toBe("3.1.0");
    expect(data.paths["/v1/search"]).toBeDefined();
  });

  test("api key enforcement for /v1 when enabled", async () => {
    mutableConfig.API_KEY_ENABLED = true;
    mutableConfig.API_KEY_VALUE = "secret-key";

    const noKey = await fetch(`${baseUrl}/v1/search?q=search%20engine`, {
      headers: { "x-forwarded-for": "10.0.0.14" },
    });
    const withKey = await fetch(`${baseUrl}/v1/search?q=search%20engine`, {
      headers: {
        "x-forwarded-for": "10.0.0.15",
        "x-api-key": "secret-key",
      },
    });

    expect(noKey.status).toBe(401);
    expect(withKey.status).toBe(200);
  });

  test("cors allowlist blocks forbidden origins", async () => {
    mutableConfig.CORS_ALLOW_ORIGIN_LIST = ["https://allowed.example"];

    const blocked = await fetch(`${baseUrl}/search?q=search`, {
      headers: {
        origin: "https://blocked.example",
        "x-forwarded-for": "10.0.0.16",
      },
    });

    expect(blocked.status).toBe(403);
  });

  test("rate limiting eventually returns 429", async () => {
    let sawRateLimit = false;
    for (let index = 0; index < 80; index += 1) {
      const response = await fetch(`${baseUrl}/search?q=search%20engine`, {
        headers: { "x-forwarded-for": "10.0.0.99" },
      });
      if (response.status === 429) {
        sawRateLimit = true;
        break;
      }
    }

    expect(sawRateLimit).toBe(true);
  });
});
