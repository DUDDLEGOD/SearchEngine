import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { config } from "./config";
import { ArxivAdapter } from "./ingestion/sources/arxiv";
import { HackerNewsAdapter } from "./ingestion/sources/hackernews";
import { RedditAdapter } from "./ingestion/sources/reddit";
import { RssAdapter } from "./ingestion/sources/rss";
import { WikipediaAdapter } from "./ingestion/sources/wikipedia";

describe("source adapters", () => {
  const originalFetch = globalThis.fetch;
  const mutableConfig = config as unknown as { RSS_FEED_LIST: string[] };

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    mutableConfig.RSS_FEED_LIST = ["https://feed.test/rss.xml"];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("wikipedia adapter parses summaries", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/w/api.php")) {
        return Response.json({
          query: {
            search: [{ title: "Search Engine" }],
          },
        });
      }

      return Response.json({
        extract: "Search engine summary",
        content_urls: {
          desktop: { page: "https://en.wikipedia.org/wiki/Search_engine" },
        },
      });
    }) as unknown as typeof fetch;

    const docs = await WikipediaAdapter.fetch("search");
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]?.source).toBe("wikipedia");
  });

  test("reddit adapter parses posts", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        data: {
          children: [
            {
              data: {
                title: "Search post",
                selftext: "Search body",
                permalink: "/r/test/1",
              },
            },
          ],
        },
      })) as unknown as typeof fetch;

    const docs = await RedditAdapter.fetch("search");
    expect(docs.length).toBe(1);
    expect(docs[0]?.source).toBe("reddit");
  });

  test("hackernews adapter parses hits", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        hits: [
          {
            title: "HN Search",
            url: "https://news.ycombinator.com/item?id=1",
            story_text: "Story text",
            created_at: "2026-03-01T00:00:00.000Z",
            author: "alice",
          },
        ],
      })) as unknown as typeof fetch;

    const docs = await HackerNewsAdapter.fetch("search");
    expect(docs.length).toBe(1);
    expect(docs[0]?.source).toBe("hn");
  });

  test("arxiv adapter parses atom xml", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `<?xml version="1.0"?>
        <feed>
          <entry>
            <id>http://arxiv.org/abs/1234.5678</id>
            <title>Neural Search</title>
            <summary>Paper summary text</summary>
            <published>2026-01-01T00:00:00Z</published>
            <author><name>Bob</name></author>
          </entry>
        </feed>`
      )) as unknown as typeof fetch;

    const docs = await ArxivAdapter.fetch("search");
    expect(docs.length).toBe(1);
    expect(docs[0]?.source).toBe("arxiv");
  });

  test("rss adapter parses rss items and filters by query", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `<rss>
          <channel>
            <item>
              <title>Search platforms</title>
              <link>https://example.com/search-platforms</link>
              <description>Guide to search ranking</description>
              <pubDate>Sun, 01 Mar 2026 00:00:00 GMT</pubDate>
            </item>
            <item>
              <title>Unrelated topic</title>
              <link>https://example.com/other</link>
              <description>Nothing relevant</description>
            </item>
          </channel>
        </rss>`
      )) as unknown as typeof fetch;

    const docs = await RssAdapter.fetch("search");
    expect(docs.length).toBe(1);
    expect(docs[0]?.source).toBe("rss");
  });
});
