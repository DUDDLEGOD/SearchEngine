import type { IngestedDocument, SourceAdapter } from "../types";

type WikipediaSearchResult = {
  title: string;
};

type WikipediaSearchResponse = {
  query?: {
    search?: WikipediaSearchResult[];
  };
};

type WikipediaSummaryResponse = {
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

export const WikipediaAdapter: SourceAdapter = {
  name: "wikipedia",

  async fetch(query: string): Promise<IngestedDocument[]> {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;

    const res = await fetch(searchUrl);
    if (!res.ok) {
      console.error(`Wikipedia search failed with status ${res.status}`);
      return [];
    }

    const data = (await res.json()) as WikipediaSearchResponse;
    const topResults = data.query?.search?.slice(0, 5) ?? [];
    if (topResults.length === 0) {
      return [];
    }

    const pagePromises = topResults.map(async (item) => {
      try {
        const pageRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.title)}`
        );

        if (!pageRes.ok) {
          return null;
        }

        const pageData = (await pageRes.json()) as WikipediaSummaryResponse;
        const pageUrl = pageData.content_urls?.desktop?.page;
        const extract = pageData.extract;

        if (!pageUrl || !extract) {
          return null;
        }

        return {
          url: pageUrl,
          title: item.title,
          content: extract,
          source: "wikipedia",
        } satisfies IngestedDocument;
      } catch {
        return null;
      }
    });

    const pages = await Promise.all(pagePromises);
    return pages.filter((doc): doc is IngestedDocument => doc !== null);
  },
};
