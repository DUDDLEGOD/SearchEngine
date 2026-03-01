export const SOURCE_NAMES = ["wikipedia", "reddit", "hn", "arxiv", "rss"] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];

export type IngestionErrorCode =
  | "timeout"
  | "network_error"
  | "parse_error"
  | "rate_limited"
  | "unknown";

export type IngestedDocument = {
  url: string;
  title: string;
  content: string;
  source: SourceName;
  publishedAt?: string;
  author?: string;
  language?: string;
};

export type SourceContext = {
  signal?: AbortSignal;
};

export interface SourceAdapter {
  name: SourceName;
  fetch(query: string, context?: SourceContext): Promise<IngestedDocument[]>;
}
