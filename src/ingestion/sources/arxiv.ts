import type { IngestedDocument, SourceAdapter } from "../types";

function extractTag(input: string, tag: string): string | null {
  const match = input.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
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

export const ArxivAdapter: SourceAdapter = {
  name: "arxiv",

  async fetch(query: string, context): Promise<IngestedDocument[]> {
    try {
      const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5`;
      const response = await fetch(url, { signal: context?.signal });
      if (!response.ok) {
        return [];
      }

      const xml = await response.text();
      const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];

      const docs: IngestedDocument[] = [];
      for (const entry of entries) {
        const id = extractTag(entry, "id");
        const title = extractTag(entry, "title");
        const summary = extractTag(entry, "summary");
        const publishedAt = extractTag(entry, "published");
        const author = extractTag(entry, "name");

        if (!id || !title || !summary) {
          continue;
        }

        docs.push({
          url: id,
          title,
          content: summary,
          source: "arxiv",
          publishedAt: publishedAt ?? undefined,
          author: author ?? undefined,
          language: "en",
        });
      }

      return docs;
    } catch {
      return [];
    }
  },
};
