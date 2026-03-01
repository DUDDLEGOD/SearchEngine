# Architecture

## Runtime
- Bun HTTP server (`src/server.ts`)
- SQLite storage (`search.db`)
- Optional background scheduler (`src/ingestion/scheduler.ts`)

## Data Flow
1. Request hits `/search` or `/v1/search`.
2. Server validates input and applies auth/CORS/rate limiting.
3. Query is recorded in `queries`.
4. Search executes BM25 scoring over `terms`, `inverted_index`, and `documents`.
5. Response is returned (legacy array or v1 envelope).
6. First-seen queries trigger async ingestion.

## Storage
- `documents`: metadata, raw/clean text, quality/freshness fields
- `terms`: term dictionary + document frequency
- `inverted_index`: term/document TF
- `term_positions`: term positions for proximity boosts
- `queries`: query usage for suggestions + scheduler priorities
- `schema_migrations`: migration history

## Cross-Cutting Concerns
- Structured JSON logs with request id
- Prometheus metrics
- Token-bucket rate limiting
- In-memory LRU+TTL search cache
- Migration-based schema evolution
