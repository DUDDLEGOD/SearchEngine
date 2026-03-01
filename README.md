# SearchEngine

Lightweight search engine with:
- SQLite-backed inverted index (`documents`, `terms`, `inverted_index`)
- NLP preprocessing (normalization, stopword removal, stemming)
- Source ingestion pipeline (Wikipedia + Reddit)
- Query tracking (`queries` table) to drive scheduler-based re-ingestion

## Install

```bash
bun install
```

## Run

```bash
bun run start
```

Server endpoint:
- `GET /search?q=<query>`

## Test

```bash
bun run test
```

## Typecheck

```bash
bun run typecheck
```

## Architecture (brief)

- `src/server.ts`: HTTP API + rate limiting + async ingestion trigger for new queries
- `src/search.ts`: TF-IDF scoring with title/phrase boosts
- `src/indexDocumentBatch.ts`: batch NLP + transactional index writes
- `src/ingestion/*`: source adapters, orchestrator, scheduler
- `src/queryLog.ts`: persistent query stats (`recordQuery`, `getTopQueries`)
