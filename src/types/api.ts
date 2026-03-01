import type { SourceName } from "../ingestion/types";

export type SearchFilters = {
  source?: SourceName;
  from?: Date;
  to?: Date;
};

export type SearchRequest = {
  query: string;
  page: number;
  limit: number;
  filters: SearchFilters;
};

export type SearchResult = {
  title: string;
  url: string;
  source: SourceName;
  score: number;
  snippet: string;
  highlights: string[];
  publishedAt: string | null;
};

export type SearchResponseV1 = {
  query: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  results: SearchResult[];
};

export type LegacySearchResult = Pick<SearchResult, "title" | "url" | "score">;

export type SuggestionResponse = {
  query: string;
  suggestions: string[];
};
