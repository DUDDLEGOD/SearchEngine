import type { IngestedDocument, SourceAdapter } from "../types";

type RedditPostData = {
  title?: string;
  selftext?: string;
  permalink?: string;
};

type RedditSearchResponse = {
  data?: {
    children?: Array<{
      data?: RedditPostData;
    }>;
  };
};

export const RedditAdapter: SourceAdapter = {
  name: "reddit",

  async fetch(query: string, context): Promise<IngestedDocument[]> {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=5`;
      const res = await fetch(url, {
        signal: context?.signal,
        headers: {
          "User-Agent": "SearchEngineBot/1.0",
        },
      });

      if (!res.ok) {
        console.error(`Reddit fetch failed with status ${res.status}`);
        return [];
      }

      const data = (await res.json()) as RedditSearchResponse;
      const posts = data.data?.children ?? [];

      const docs: IngestedDocument[] = [];
      for (const post of posts) {
        const postData = post.data;
        if (!postData?.title || !postData.selftext || !postData.permalink) {
          continue;
        }

        docs.push({
          url: `https://reddit.com${postData.permalink}`,
          title: postData.title,
          content: `${postData.title} ${postData.selftext}`,
          source: "reddit",
          language: "en",
        });
      }

      return docs;
    } catch (error) {
      console.error("Reddit fetch error:", error);
      return [];
    }
  },
};
