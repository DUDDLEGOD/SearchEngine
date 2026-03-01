import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "./db";
import { ingest, resetSourceAdaptersForTest, setSourceAdaptersForTest } from "./ingestion/orchestrator";
import type { SourceAdapter } from "./ingestion/types";
import { initDb } from "./initDb";

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

describe("orchestrator resilience", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    resetSourceAdaptersForTest();
  });

  test("isolates source failures and still indexes successful source", async () => {
    const failingSource: SourceAdapter = {
      name: "rss",
      async fetch() {
        throw new Error("source failed");
      },
    };

    const successfulSource: SourceAdapter = {
      name: "hn",
      async fetch() {
        return [
          {
            url: "https://example.com/doc",
            title: "Resilient ingestion title",
            content: "This ingestion pipeline should continue despite one source failure.",
            source: "hn",
            publishedAt: "2026-03-01T00:00:00.000Z",
          },
        ];
      },
    };

    setSourceAdaptersForTest([failingSource, successfulSource]);
    await ingest("resilience");

    const countStmt = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM documents");
    const count = countStmt.get()?.count ?? 0;
    expect(count).toBe(1);
  });

  test("retries source fetch and eventually succeeds", async () => {
    let attempts = 0;
    const flakySource: SourceAdapter = {
      name: "wikipedia",
      async fetch() {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("temporary failure");
        }
        return [
          {
            url: "https://example.com/retry-doc",
            title: "Retry behavior document",
            content: "Retry logic should eventually index this document successfully.",
            source: "wikipedia",
            publishedAt: "2026-03-01T00:00:00.000Z",
          },
        ];
      },
    };

    setSourceAdaptersForTest([flakySource]);
    await ingest("retry");

    expect(attempts).toBeGreaterThanOrEqual(3);
    const countStmt = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM documents");
    const count = countStmt.get()?.count ?? 0;
    expect(count).toBe(1);
  });
});
