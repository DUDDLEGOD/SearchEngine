ALTER TABLE documents ADD COLUMN raw_text TEXT;
ALTER TABLE documents ADD COLUMN content_hash TEXT;
ALTER TABLE documents ADD COLUMN published_at DATETIME;
ALTER TABLE documents ADD COLUMN last_crawled_at DATETIME;
ALTER TABLE documents ADD COLUMN quality_score REAL DEFAULT 0;
ALTER TABLE documents ADD COLUMN language TEXT;

CREATE TABLE IF NOT EXISTS term_positions (
  term_id INTEGER,
  document_id INTEGER,
  positions TEXT,
  PRIMARY KEY (term_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_published_at ON documents(published_at);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_term_positions_term_id ON term_positions(term_id);
