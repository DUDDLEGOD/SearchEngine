import pLimit from "p-limit";
import { indexDocumentBatch } from "../indexDocumentBatch";
import { RedditAdapter } from "./sources/reddit";
import { WikipediaAdapter } from "./sources/wikipedia";
import type { IngestedDocument, SourceAdapter } from "./types";

const sources: SourceAdapter[] = [WikipediaAdapter, RedditAdapter];
const limit = pLimit(3);

export async function ingest(query: string): Promise<void> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return;
  }

  console.log(`Ingestion started for: ${normalizedQuery}`);

  await limit(async () => {
    const fetchPromises = sources.map((source) => source.fetch(normalizedQuery));
    const results = await Promise.allSettled(fetchPromises);

    const allDocs: IngestedDocument[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        allDocs.push(...result.value);
      }
    }

    const uniqueDocs = new Map<string, IngestedDocument>();
    for (const doc of allDocs) {
      if (!uniqueDocs.has(doc.url)) {
        uniqueDocs.set(doc.url, doc);
      }
    }

    await indexDocumentBatch([...uniqueDocs.values()]);
  });

  console.log(`Ingestion completed for: ${normalizedQuery}`);
}
