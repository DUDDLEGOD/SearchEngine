import { config } from "../config";
import { LruTtlCache } from "../cache/lru";
import type { SearchResponseV1 } from "../types/api";

export type CorpusStats = {
  totalDocs: number;
  avgDocLength: number;
};

const responseCache = new LruTtlCache<SearchResponseV1>(
  config.CACHE_MAX_ENTRIES,
  config.CACHE_TTL_MS
);

let corpusStatsCache: CorpusStats | null = null;

export function getCachedSearchResponse(key: string): SearchResponseV1 | undefined {
  return responseCache.get(key);
}

export function setCachedSearchResponse(key: string, value: SearchResponseV1) {
  responseCache.set(key, value);
}

export function getCachedCorpusStats(): CorpusStats | null {
  return corpusStatsCache;
}

export function setCachedCorpusStats(stats: CorpusStats) {
  corpusStatsCache = stats;
}

export function invalidateSearchCaches() {
  responseCache.clear();
  corpusStatsCache = null;
}
