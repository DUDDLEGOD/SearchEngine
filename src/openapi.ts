export function getOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "SearchEngine API",
      version: "1.0.0",
      description: "Search and ingestion API for the SearchEngine project.",
    },
    servers: [{ url: "http://localhost:3000" }],
    paths: {
      "/search": {
        get: {
          summary: "Legacy search endpoint",
          parameters: [
            { in: "query", name: "q", required: true, schema: { type: "string" } },
            { in: "query", name: "page", required: false, schema: { type: "integer", minimum: 1 } },
            { in: "query", name: "limit", required: false, schema: { type: "integer", minimum: 1 } },
          ],
          responses: {
            "200": {
              description: "Legacy search results",
            },
          },
        },
      },
      "/v1/search": {
        get: {
          summary: "Versioned search endpoint",
          parameters: [
            { in: "query", name: "q", required: true, schema: { type: "string" } },
            { in: "query", name: "page", required: false, schema: { type: "integer", minimum: 1 } },
            { in: "query", name: "limit", required: false, schema: { type: "integer", minimum: 1 } },
            { in: "query", name: "source", required: false, schema: { type: "string" } },
            { in: "query", name: "from", required: false, schema: { type: "string", format: "date-time" } },
            { in: "query", name: "to", required: false, schema: { type: "string", format: "date-time" } },
          ],
          responses: {
            "200": {
              description: "Versioned search response envelope",
            },
          },
        },
      },
      "/v1/suggest": {
        get: {
          summary: "Autocomplete suggestions",
          parameters: [
            { in: "query", name: "q", required: true, schema: { type: "string" } },
            { in: "query", name: "limit", required: false, schema: { type: "integer", minimum: 1, maximum: 20 } },
          ],
          responses: {
            "200": { description: "Suggestion response" },
          },
        },
      },
      "/health": {
        get: {
          summary: "Liveness endpoint",
          responses: {
            "200": { description: "Service is alive" },
          },
        },
      },
      "/ready": {
        get: {
          summary: "Readiness endpoint",
          responses: {
            "200": { description: "Service is ready" },
            "503": { description: "Service is not ready" },
          },
        },
      },
      "/metrics": {
        get: {
          summary: "Prometheus metrics endpoint",
          responses: {
            "200": { description: "Metrics payload" },
          },
        },
      },
    },
  };
}
