# SearchEngine

SearchEngine is a Bun + SQLite search service with:
- Versioned and legacy search APIs
- BM25 ranking with typo/synonym expansion and proximity boosts
- Multi-source ingestion (Wikipedia, Reddit, Hacker News, arXiv, RSS)
- Query tracking, scheduler-driven refresh, cache, metrics, and CI coverage gating

## Quick Start

1. Install dependencies:
```bash
bun install
```

2. Copy env defaults:
```bash
cp .env.example .env
```

3. Run:
```bash
bun run start
```

## Scripts

- `bun run dev` - start local server
- `bun run typecheck` - TypeScript checks
- `bun run test` - run tests
- `bun run test:coverage` - run tests with coverage
- `bun run check:coverage` - enforce 85% line coverage
- `bun run ci` - typecheck + coverage-gated tests

## API Endpoints

- `GET /search?q=...`  
Legacy endpoint, returns `[{ title, url, score }]`

- `GET /v1/search?q=...&page=1&limit=10&source=...&from=...&to=...`  
Returns:
```json
{
  "query": "string",
  "page": 1,
  "limit": 10,
  "total": 100,
  "totalPages": 10,
  "results": [
    {
      "title": "string",
      "url": "string",
      "source": "wikipedia",
      "score": 1.23,
      "snippet": "string",
      "highlights": ["search"],
      "publishedAt": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

- `GET /v1/suggest?q=...&limit=8`  
Returns `{ query, suggestions }`

- `GET /health` / `GET /ready`
- `GET /metrics` (Prometheus format)
- `GET /openapi.json`

## Architecture

- `src/server.ts` - routing, validation, auth, CORS, rate limit, metrics/logging
- `src/search.ts` - BM25 search engine and suggestion logic
- `src/indexDocumentBatch.ts` - quality scoring, dedup, recrawl-aware indexing
- `src/ingestion/*` - source adapters, retries/timeouts, scheduler orchestration
- `src/migrations/*` - schema migrations

Detailed docs:
- `docs/architecture.md`
- `docs/api.md`
- `docs/ingestion.md`
- `docs/runbook.md`
