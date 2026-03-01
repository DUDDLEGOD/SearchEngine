import pLimit from "p-limit";
import { config } from "../config";
import { indexDocumentBatch } from "../indexDocumentBatch";
import { log } from "../logging";
import { recordIngestionDuration, recordIngestionJob } from "../metrics";
import { ArxivAdapter } from "./sources/arxiv";
import { HackerNewsAdapter } from "./sources/hackernews";
import { RedditAdapter } from "./sources/reddit";
import { RssAdapter } from "./sources/rss";
import { WikipediaAdapter } from "./sources/wikipedia";
import type { IngestedDocument, SourceAdapter } from "./types";

const limit = pLimit(3);

const defaultSourceAdapters: SourceAdapter[] = [
  WikipediaAdapter,
  RedditAdapter,
  HackerNewsAdapter,
  ArxivAdapter,
  RssAdapter,
];

let sourceAdapters: SourceAdapter[] = [...defaultSourceAdapters];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeoutAndRetry(
  source: SourceAdapter,
  query: string
): Promise<IngestedDocument[]> {
  let attempt = 0;

  while (attempt <= config.SOURCE_MAX_RETRIES) {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.SOURCE_TIMEOUT_MS);

    try {
      const docs = await source.fetch(query, { signal: controller.signal });
      clearTimeout(timeout);

      recordIngestionJob(source.name, "success");
      recordIngestionDuration(source.name, performance.now() - startedAt);
      return docs;
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      const status = message.toLowerCase().includes("abort")
        ? "timeout"
        : "error";

      recordIngestionJob(source.name, status);
      recordIngestionDuration(source.name, performance.now() - startedAt);

      if (attempt >= config.SOURCE_MAX_RETRIES) {
        log("warn", "ingestion.source.failed", {
          source: source.name,
          query,
          attempt,
          status,
          message,
        });
        return [];
      }

      attempt += 1;
      const delay = 250 * 2 ** attempt;
      await sleep(delay);
    }
  }

  return [];
}

export async function ingest(query: string): Promise<void> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return;
  }

  await limit(async () => {
    const fetchPromises = sourceAdapters.map((source) =>
      fetchWithTimeoutAndRetry(source, normalizedQuery)
    );

    const results = await Promise.all(fetchPromises);
    const allDocs: IngestedDocument[] = [];
    for (const docs of results) {
      allDocs.push(...docs);
    }

    const uniqueDocs = new Map<string, IngestedDocument>();
    for (const doc of allDocs) {
      if (!uniqueDocs.has(doc.url)) {
        uniqueDocs.set(doc.url, doc);
      }
    }

    if (uniqueDocs.size === 0) {
      return;
    }

    await indexDocumentBatch([...uniqueDocs.values()], {
      staleMs: config.RECRAWL_STALE_MS,
      force: false,
    });
  });
}

export function setSourceAdaptersForTest(adapters: SourceAdapter[]) {
  sourceAdapters = adapters;
}

export function resetSourceAdaptersForTest() {
  sourceAdapters = [...defaultSourceAdapters];
}
