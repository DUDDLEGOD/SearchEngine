# Runbook

## Startup
1. `bun install`
2. Configure `.env` from `.env.example`
3. `bun run start`

## Health Checks
- Liveness: `GET /health`
- Readiness: `GET /ready`
- Metrics: `GET /metrics`

## Common Issues

### High 429 responses
- Increase `RATE_LIMIT_CAPACITY` or `RATE_LIMIT_REFILL_PER_SEC`.
- Confirm request bursts are expected.

### Empty search results
- Validate ingestion sources are reachable.
- Check document quality threshold (`QUALITY_THRESHOLD`).
- Confirm documents exist in `documents` table.

### Slow queries
- Inspect `/metrics` latency histograms.
- Reduce `SEARCH_MAX_LIMIT` if needed.
- Tune cache settings (`CACHE_TTL_MS`, `CACHE_MAX_ENTRIES`).

### Ingestion failures
- Check logs for `ingestion.source.failed`.
- Validate outbound network access to source APIs.
- Adjust `SOURCE_TIMEOUT_MS` and retry settings.

## Graceful Shutdown
Server handles `SIGINT`/`SIGTERM`:
1. Stops scheduler
2. Stops HTTP server
3. Closes SQLite handle
