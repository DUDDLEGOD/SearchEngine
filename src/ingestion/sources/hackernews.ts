import type { IngestedDocument, SourceAdapter } from "../types";

type HackerNewsHit = {
  title?: string;
  url?: string;
  story_url?: string;
  story_text?: string;
  comment_text?: string;
  created_at?: string;
  author?: string;
};

type HackerNewsResponse = {
  hits?: HackerNewsHit[];
};

export const HackerNewsAdapter: SourceAdapter = {
  name: "hn",

  async fetch(query: string, context): Promise<IngestedDocument[]> {
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=10`;
      const response = await fetch(url, { signal: context?.signal });
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as HackerNewsResponse;
      const hits = data.hits ?? [];
      const docs: IngestedDocument[] = [];

      for (const hit of hits) {
        const title = hit.title?.trim();
        const href = hit.url?.trim() || hit.story_url?.trim();
        const body = hit.story_text?.trim() || hit.comment_text?.trim() || title;

        if (!title || !href || !body) {
          continue;
        }

        docs.push({
          url: href,
          title,
          content: body,
          source: "hn",
          publishedAt: hit.created_at,
          author: hit.author,
          language: "en",
        });
      }

      return docs;
    } catch {
      return [];
    }
  },
};
