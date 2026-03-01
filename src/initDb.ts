import { db } from "./db";

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title TEXT,
      clean_text TEXT,
      doc_length INTEGER,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT UNIQUE,
      document_frequency INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inverted_index (
      term_id INTEGER,
      document_id INTEGER,
      term_frequency INTEGER,
      PRIMARY KEY (term_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT UNIQUE,
      hit_count INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_term ON terms(term);
    CREATE INDEX IF NOT EXISTS idx_term_id ON inverted_index(term_id);
    CREATE INDEX IF NOT EXISTS idx_doc_id ON inverted_index(document_id);
    CREATE INDEX IF NOT EXISTS idx_queries_hit_count ON queries(hit_count DESC);
    CREATE INDEX IF NOT EXISTS idx_queries_last_seen ON queries(last_seen_at DESC);
  `);

  console.log("Database initialized.");
}
