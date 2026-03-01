import { createHash } from "node:crypto";
import { config } from "./config";
import { db } from "./db";
import type { IngestedDocument } from "./ingestion/types";
import { preprocess } from "./nlp";
import { invalidateSearchCaches } from "./search/cache";

type ProcessedDoc = {
  url: string;
  title: string;
  source: string;
  rawText: string;
  cleanText: string;
  tokens: string[];
  tokenPositions: Map<string, number[]>;
  contentHash: string;
  qualityScore: number;
  publishedAt: string | null;
  language: string | null;
};

type ExistingDocRow = {
  id: number;
  content_hash: string | null;
  last_crawled_at: string | null;
};

type ExistingPostingRow = {
  term_id: number;
};

type TermRow = {
  id: number;
};

type IndexOptions = {
  force?: boolean;
  staleMs?: number;
};

type StatementBundle = {
  existingDocStmt: ReturnType<typeof db.query<ExistingDocRow, [string]>>;
  insertDocStmt: ReturnType<
    typeof db.query<
      unknown,
      [string, string, string, string, number, string, string, number, string | null, string | null]
    >
  >;
  updateDocStmt: ReturnType<
    typeof db.query<
      unknown,
      [string, string, string, number, string, string, number, string | null, string | null, number]
    >
  >;
  touchDocStmt: ReturnType<typeof db.query<unknown, [number]>>;
  findByHashStmt: ReturnType<typeof db.query<{ id: number }, [string]>>;
  getExistingPostingsStmt: ReturnType<typeof db.query<ExistingPostingRow, [number]>>;
  decrementDfStmt: ReturnType<typeof db.query<unknown, [number]>>;
  deletePostingsStmt: ReturnType<typeof db.query<unknown, [number]>>;
  deletePositionsStmt: ReturnType<typeof db.query<unknown, [number]>>;
  insertTermStmt: ReturnType<typeof db.query<unknown, [string]>>;
  termLookupStmt: ReturnType<typeof db.query<TermRow, [string]>>;
  insertPostingStmt: ReturnType<typeof db.query<unknown, [number, number, number]>>;
  insertPositionsStmt: ReturnType<typeof db.query<unknown, [number, number, string]>>;
  incrementDfStmt: ReturnType<typeof db.query<unknown, [number]>>;
};

let statementBundle: StatementBundle | null = null;

function getStatements(): StatementBundle {
  if (statementBundle) {
    return statementBundle;
  }

  statementBundle = {
    existingDocStmt: db.query<ExistingDocRow, [string]>(
      "SELECT id, content_hash, last_crawled_at FROM documents WHERE url = ?"
    ),
    insertDocStmt: db.query<
      unknown,
      [string, string, string, string, number, string, string, number, string | null, string | null]
    >(
      `INSERT INTO documents
       (url, title, raw_text, clean_text, doc_length, source, content_hash, quality_score, published_at, language, last_crawled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ),
    updateDocStmt: db.query<
      unknown,
      [string, string, string, number, string, string, number, string | null, string | null, number]
    >(
      `UPDATE documents
       SET title = ?,
           raw_text = ?,
           clean_text = ?,
           doc_length = ?,
           source = ?,
           content_hash = ?,
           quality_score = ?,
           published_at = ?,
           language = ?,
           last_crawled_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ),
    touchDocStmt: db.query<unknown, [number]>(
      "UPDATE documents SET last_crawled_at = CURRENT_TIMESTAMP WHERE id = ?"
    ),
    findByHashStmt: db.query<{ id: number }, [string]>(
      "SELECT id FROM documents WHERE content_hash = ? LIMIT 1"
    ),
    getExistingPostingsStmt: db.query<ExistingPostingRow, [number]>(
      "SELECT term_id FROM inverted_index WHERE document_id = ?"
    ),
    decrementDfStmt: db.query<unknown, [number]>(
      `UPDATE terms
       SET document_frequency = CASE
          WHEN document_frequency > 0 THEN document_frequency - 1
          ELSE 0
       END
       WHERE id = ?`
    ),
    deletePostingsStmt: db.query<unknown, [number]>(
      "DELETE FROM inverted_index WHERE document_id = ?"
    ),
    deletePositionsStmt: db.query<unknown, [number]>(
      "DELETE FROM term_positions WHERE document_id = ?"
    ),
    insertTermStmt: db.query<unknown, [string]>(
      `INSERT OR IGNORE INTO terms (term, document_frequency)
       VALUES (?, 0)`
    ),
    termLookupStmt: db.query<TermRow, [string]>(
      "SELECT id FROM terms WHERE term = ?"
    ),
    insertPostingStmt: db.query<unknown, [number, number, number]>(
      `INSERT INTO inverted_index (term_id, document_id, term_frequency)
       VALUES (?, ?, ?)`
    ),
    insertPositionsStmt: db.query<unknown, [number, number, string]>(
      `INSERT INTO term_positions (term_id, document_id, positions)
       VALUES (?, ?, ?)`
    ),
    incrementDfStmt: db.query<unknown, [number]>(
      `UPDATE terms
       SET document_frequency = document_frequency + 1
       WHERE id = ?`
    ),
  };

  return statementBundle;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function contentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

function calculateQualityScore(title: string, content: string): number {
  const words = content.split(/\s+/).filter(Boolean);
  const letters = (content.match(/[a-z]/gi) ?? []).length;
  const alphaRatio = content.length > 0 ? letters / content.length : 0;

  const simpleTokens = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const filteredTokens = preprocess(content);
  const stopwordRatio =
    simpleTokens.length > 0
      ? Math.max(0, Math.min(1, 1 - filteredTokens.length / simpleTokens.length))
      : 0;

  const titleScore = title.trim().length > 3 ? 0.2 : 0;
  const lengthScore = Math.min(words.length / 200, 1) * 0.4;
  const alphaScore = Math.min(alphaRatio, 1) * 0.25;
  const stopwordBalanceScore = (1 - Math.abs(0.35 - stopwordRatio)) * 0.15;

  return Number(
    Math.max(0, Math.min(1, titleScore + lengthScore + alphaScore + stopwordBalanceScore)).toFixed(3)
  );
}

function buildProcessedDoc(doc: IngestedDocument): ProcessedDoc | null {
  const rawText = doc.content.trim();
  if (!rawText) {
    return null;
  }

  const tokens = preprocess(rawText);
  if (tokens.length === 0) {
    return null;
  }

  const qualityScore = calculateQualityScore(doc.title, rawText);
  if (qualityScore < config.QUALITY_THRESHOLD) {
    return null;
  }

  const tokenPositions = new Map<string, number[]>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    const positions = tokenPositions.get(token) ?? [];
    positions.push(index);
    tokenPositions.set(token, positions);
  }

  return {
    url: doc.url,
    title: doc.title,
    source: doc.source,
    rawText,
    cleanText: tokens.join(" "),
    tokens,
    tokenPositions,
    contentHash: contentHash(rawText),
    qualityScore,
    publishedAt: doc.publishedAt ?? null,
    language: doc.language ?? null,
  };
}

function shouldSkipFreshDocument(
  row: ExistingDocRow,
  staleMs: number,
  force: boolean
): boolean {
  if (force) {
    return false;
  }

  if (!row.last_crawled_at) {
    return false;
  }

  const lastCrawled = Date.parse(row.last_crawled_at);
  if (Number.isNaN(lastCrawled)) {
    return false;
  }

  return Date.now() - lastCrawled < staleMs;
}

function removeExistingDocumentTerms(docId: number) {
  const statements = getStatements();
  const oldPostings = statements.getExistingPostingsStmt.all(docId);
  for (const posting of oldPostings) {
    statements.decrementDfStmt.run(posting.term_id);
  }

  statements.deletePostingsStmt.run(docId);
  statements.deletePositionsStmt.run(docId);
}

function insertDocumentTerms(docId: number, processedDoc: ProcessedDoc) {
  const statements = getStatements();
  const termFrequency = new Map<string, number>();
  for (const token of processedDoc.tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  for (const [term, frequency] of termFrequency.entries()) {
    statements.insertTermStmt.run(term);
    const termRow = statements.termLookupStmt.get(term);
    if (!termRow) {
      continue;
    }

    statements.insertPostingStmt.run(termRow.id, docId, frequency);
    statements.incrementDfStmt.run(termRow.id);

    const positions = processedDoc.tokenPositions.get(term) ?? [];
    statements.insertPositionsStmt.run(termRow.id, docId, JSON.stringify(positions));
  }
}

export async function indexDocumentBatch(
  docs: IngestedDocument[],
  options: IndexOptions = {}
): Promise<void> {
  if (docs.length === 0) {
    return;
  }

  const staleMs = options.staleMs ?? config.RECRAWL_STALE_MS;
  const force = options.force ?? false;

  const processedDocs: ProcessedDoc[] = [];
  for (const doc of docs) {
    const processed = buildProcessedDoc(doc);
    if (processed) {
      processedDocs.push(processed);
    }
  }

  if (processedDocs.length === 0) {
    return;
  }

  const statements = getStatements();

  const transaction = db.transaction((batch: ProcessedDoc[]) => {
    for (const processedDoc of batch) {
      const existing = statements.existingDocStmt.get(processedDoc.url);
      const duplicateHash = statements.findByHashStmt.get(processedDoc.contentHash);

      if (!existing && duplicateHash) {
        continue;
      }

      if (!existing) {
        const insertResult = statements.insertDocStmt.run(
          processedDoc.url,
          processedDoc.title,
          processedDoc.rawText,
          processedDoc.cleanText,
          processedDoc.tokens.length,
          processedDoc.source,
          processedDoc.contentHash,
          processedDoc.qualityScore,
          processedDoc.publishedAt,
          processedDoc.language
        );

        const docId = Number(insertResult.lastInsertRowid);
        insertDocumentTerms(docId, processedDoc);
        continue;
      }

      if (shouldSkipFreshDocument(existing, staleMs, force)) {
        continue;
      }

      if (existing.content_hash === processedDoc.contentHash) {
        statements.touchDocStmt.run(existing.id);
        continue;
      }

      removeExistingDocumentTerms(existing.id);
      statements.updateDocStmt.run(
        processedDoc.title,
        processedDoc.rawText,
        processedDoc.cleanText,
        processedDoc.tokens.length,
        processedDoc.source,
        processedDoc.contentHash,
        processedDoc.qualityScore,
        processedDoc.publishedAt,
        processedDoc.language,
        existing.id
      );
      insertDocumentTerms(existing.id, processedDoc);
    }
  });

  transaction(processedDocs);
  invalidateSearchCaches();
}
