import { config } from "../../config";
import type { IngestedDocument, SourceAdapter } from "../types";

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) {
    return null;
  }

  const value = match[1] ?? "";

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const RssAdapter: SourceAdapter = {
  name: "rss",

  async fetch(query: string, context): Promise<IngestedDocument[]> {
    const docs: IngestedDocument[] = [];
    const loweredQuery = query.toLowerCase();

    for (const feedUrl of config.RSS_FEED_LIST) {
      try {
        const response = await fetch(feedUrl, { signal: context?.signal });
        if (!response.ok) {
          continue;
        }

        const xml = await response.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
        for (const item of items.slice(0, 20)) {
          const title = extractTag(item, "title");
          const link = extractTag(item, "link");
          const description = extractTag(item, "description") ?? "";
          const pubDate = extractTag(item, "pubDate");

          if (!title || !link) {
            continue;
          }

          const searchableText = `${title} ${description}`.toLowerCase();
          if (!searchableText.includes(loweredQuery)) {
            continue;
          }

          docs.push({
            url: link,
            title,
            content: description || title,
            source: "rss",
            publishedAt: pubDate ?? undefined,
            language: "en",
          });
        }
      } catch {
        continue;
      }
    }

    return docs.slice(0, 15);
  },
};
