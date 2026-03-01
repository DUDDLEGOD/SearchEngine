# Ingestion Guide

## Adapters
Implemented adapters:
- `wikipedia`
- `reddit`
- `hn` (Hacker News Algolia API)
- `arxiv` (Atom API)
- `rss` (config-driven feed list)

## Orchestration
- Per-source timeout: `SOURCE_TIMEOUT_MS` (default `10000`)
- Retry: exponential backoff, up to `SOURCE_MAX_RETRIES` (default `2`)
- Source failures are isolated and do not stop other sources

## Indexing Pipeline
1. Normalize and tokenize text.
2. Compute content hash for dedup.
3. Quality-score content (`QUALITY_THRESHOLD` gate).
4. Insert/update documents.
5. Update terms, inverted index, and term positions.
6. Invalidate search caches.

## Incremental Recrawl
- Uses `last_crawled_at` and `RECRAWL_STALE_MS` (default `24h`).
- Fresh docs are skipped unless forced.
- Changed stale docs are reindexed.

## Scheduler
- Runs if `ENABLE_SCHEDULER=true`.
- Pulls top queries from `queries`.
- Falls back to static seed queries when history is empty.
