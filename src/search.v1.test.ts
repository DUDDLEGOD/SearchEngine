import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "./db";
import { indexDocumentBatch } from "./indexDocumentBatch";
import { initDb } from "./initDb";
import { recordQuery } from "./queryLog";
import { searchV1, suggest } from "./search";
import type { IngestedDocument } from "./ingestion/types";

const docs: IngestedDocument[] = [
  {
    url: "https://example.com/search-engine",
    title: "Search Engine Fundamentals",
    content: "Learn how a search engine indexes and ranks pages quickly.",
    source: "wikipedia",
    publishedAt: "2026-02-01T00:00:00.000Z",
    language: "en",
  },
  {
    url: "https://example.com/ml",
    title: "Machine Learning in Ranking",
    content: "Machine learning boosts ranking quality in modern retrieval systems.",
    source: "hn",
    publishedAt: "2026-02-10T00:00:00.000Z",
    language: "en",
  },
  {
    url: "https://example.com/cooking",
    title: "Cooking Pasta Guide",
    content: "Recipe ideas for pasta and sauce combinations.",
    source: "rss",
    publishedAt: "2025-12-10T00:00:00.000Z",
    language: "en",
  },
];

function resetDatabase() {
  db.exec(`
    DROP TABLE IF EXISTS term_positions;
    DROP TABLE IF EXISTS inverted_index;
    DROP TABLE IF EXISTS terms;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS queries;
    DROP TABLE IF EXISTS schema_migrations;
  `);
  initDb();
}

describe("v1 search behavior", () => {
  beforeEach(async () => {
    resetDatabase();
    await indexDocumentBatch(docs, { force: true });
  });

  test("returns paginated envelope with totals", async () => {
    const response = await searchV1({
      query: "search engine",
      page: 1,
      limit: 2,
      filters: {},
    });

    expect(response.query).toBe("search engine");
    expect(response.page).toBe(1);
    expect(response.limit).toBe(2);
    expect(response.total).toBeGreaterThan(0);
    expect(response.totalPages).toBeGreaterThanOrEqual(1);
    expect(response.results.length).toBeLessThanOrEqual(2);
  });

  test("applies source and date filters", async () => {
    const response = await searchV1({
      query: "ranking",
      page: 1,
      limit: 10,
      filters: {
        source: "hn",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-12-31T23:59:59.000Z"),
      },
    });

    expect(response.results.length).toBeGreaterThan(0);
    for (const result of response.results) {
      expect(result.source).toBe("hn");
    }
  });

  test("includes snippets and highlights", async () => {
    const response = await searchV1({
      query: "search",
      page: 1,
      limit: 10,
      filters: {},
    });

    expect(response.results.length).toBeGreaterThan(0);
    const first = response.results[0];
    if (!first) {
      throw new Error("Expected at least one result");
    }
    expect(first.snippet.length).toBeGreaterThan(0);
    expect(first.highlights.length).toBeGreaterThan(0);
  });

  test("supports typo and synonym expansion", async () => {
    const response = await searchV1({
      query: "find engne",
      page: 1,
      limit: 10,
      filters: {},
    });

    expect(response.results.some((result) => result.title.includes("Search Engine"))).toBe(true);
  });

  test("suggest combines history and term prefixes", async () => {
    recordQuery("search engine");
    recordQuery("search optimization");
    const suggestions = await suggest("sear", 5);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.startsWith("sear")).toBe(true);
  });
});
