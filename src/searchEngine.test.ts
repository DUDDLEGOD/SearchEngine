import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "./db";
import { indexDocumentBatch } from "./indexDocumentBatch";
import { initDb } from "./initDb";
import { getTopQueries, recordQuery } from "./queryLog";
import { search } from "./search";
import type { IngestedDocument } from "./ingestion/types";

const seedDocs: IngestedDocument[] = [
  {
    url: "doc1",
    title: "Search Engine Design",
    content: "Search engine design and ranking algorithms",
    source: "test",
  },
  {
    url: "doc2",
    title: "Machine Learning Basics",
    content: "Machine learning improves search engine accuracy",
    source: "test",
  },
  {
    url: "doc3",
    title: "Cooking Pasta Recipe",
    content: "Cooking pasta with tomato sauce and cheese",
    source: "test",
  },
];

type CountRow = { count: number };
type TermDfRow = { document_frequency: number };
type QueryHitRow = { hit_count: number };

function resetDatabase() {
  db.exec(`
    DROP TABLE IF EXISTS inverted_index;
    DROP TABLE IF EXISTS terms;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS queries;
  `);
  initDb();
}

async function seedDocuments() {
  await indexDocumentBatch(seedDocs);
}

describe("SearchEngine stability suite", () => {
  beforeEach(async () => {
    resetDatabase();
    await seedDocuments();
  });

  test("duplicate ingestion is skipped", async () => {
    const countStmt = db.query<CountRow, []>("SELECT COUNT(*) as count FROM documents");
    const before = countStmt.get()?.count ?? 0;

    await seedDocuments();

    const after = countStmt.get()?.count ?? 0;
    expect(after).toBe(before);
  });

  test("document frequency does not inflate on duplicate ingestion", async () => {
    const dfStmt = db.query<TermDfRow, [string]>(
      "SELECT document_frequency FROM terms WHERE term = ?"
    );

    const before = dfStmt.get("search")?.document_frequency ?? 0;
    await seedDocuments();
    const after = dfStmt.get("search")?.document_frequency ?? 0;

    expect(after).toBe(before);
  });

  test("search is case-insensitive", async () => {
    const lower = await search("search engine");
    const upper = await search("SEARCH ENGINE");

    expect(upper).toEqual(lower);
  });

  test("stopwords are ignored", async () => {
    const results = await search("the and of search engine");
    expect(results.length).toBeGreaterThan(0);
  });

  test("special characters are normalized", async () => {
    const results = await search("search!!! engine???");
    expect(results.length).toBeGreaterThan(0);
  });

  test("very long queries do not crash", async () => {
    const longQuery = "search ".repeat(1000);
    const results = await search(longQuery);
    expect(Array.isArray(results)).toBe(true);
  });

  test("nonsense queries return no results", async () => {
    const results = await search("quantum banana spaceship wizard");
    expect(results.length).toBe(0);
  });

  test("empty queries return no results", async () => {
    const results = await search("");
    expect(results.length).toBe(0);
  });

  test("concurrent searches all resolve", async () => {
    const queries = [
      "search engine",
      "machine learning",
      "pasta recipe",
      "ranking algorithms",
      "accuracy search",
    ];

    const results = await Promise.all(queries.map((q) => search(q)));
    expect(results.length).toBe(queries.length);
    for (const result of results) {
      expect(Array.isArray(result)).toBe(true);
    }
  });

  test("recordQuery reports first-seen query", () => {
    const first = recordQuery("search engine");
    const second = recordQuery("search engine");

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
  });

  test("query hit counts increment and top queries are sorted", () => {
    recordQuery("machine learning");
    recordQuery("machine learning");
    recordQuery("machine learning");

    recordQuery("search engine");
    recordQuery("search engine");

    const hitStmt = db.query<QueryHitRow, [string]>(
      "SELECT hit_count FROM queries WHERE query = ?"
    );

    const machineLearningHits = hitStmt.get("machine learning")?.hit_count ?? 0;
    const searchEngineHits = hitStmt.get("search engine")?.hit_count ?? 0;

    expect(machineLearningHits).toBe(3);
    expect(searchEngineHits).toBe(2);

    const topQueries = getTopQueries(2);
    expect(topQueries).toEqual(["machine learning", "search engine"]);
  });
});
