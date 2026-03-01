import { db } from "./db";
import type { IngestedDocument } from "./ingestion/types";
import { preprocess } from "./nlp";

type ProcessedDoc = {
  url: string;
  title: string;
  tokens: string[];
  source: string;
};

type ExistingDocRow = {
  id: number;
};

type TermRow = {
  id: number;
};

const existingDocStmt = db.query<ExistingDocRow, [string]>(
  "SELECT id FROM documents WHERE url = ?"
);

const insertDocStmt = db.query<unknown, [string, string, string, number, string]>(
  `INSERT INTO documents (url, title, clean_text, doc_length, source)
   VALUES (?, ?, ?, ?, ?)`
);

const insertTermStmt = db.query<unknown, [string]>(
  `INSERT OR IGNORE INTO terms (term, document_frequency)
   VALUES (?, 0)`
);

const termLookupStmt = db.query<TermRow, [string]>(
  "SELECT id FROM terms WHERE term = ?"
);

const insertPostingStmt = db.query<unknown, [number, number, number]>(
  `INSERT INTO inverted_index (term_id, document_id, term_frequency)
   VALUES (?, ?, ?)`
);

const incrementDfStmt = db.query<unknown, [number]>(
  `UPDATE terms
   SET document_frequency = document_frequency + 1
   WHERE id = ?`
);

export async function indexDocumentBatch(docs: IngestedDocument[]): Promise<void> {
  if (docs.length === 0) {
    return;
  }

  console.log(`Batch indexing ${docs.length} documents...`);

  const processed = await Promise.all(
    docs.map(async (doc) => {
      try {
        const tokens = preprocess(doc.content);
        if (tokens.length === 0) {
          return null;
        }

        return {
          url: doc.url,
          title: doc.title,
          tokens,
          source: doc.source,
        } satisfies ProcessedDoc;
      } catch (error) {
        console.error("NLP error:", error);
        return null;
      }
    })
  );

  const processedDocs = processed.filter(
    (doc): doc is ProcessedDoc => doc !== null
  );
  if (processedDocs.length === 0) {
    return;
  }

  const transaction = db.transaction((documents: ProcessedDoc[]) => {
    for (const doc of documents) {
      if (existingDocStmt.get(doc.url)) {
        console.log(`Skipping duplicate doc: ${doc.url}`);
        continue;
      }

      const docLength = doc.tokens.length;
      const insertResult = insertDocStmt.run(
        doc.url,
        doc.title,
        doc.tokens.join(" "),
        docLength,
        doc.source
      );
      const docId = Number(insertResult.lastInsertRowid);

      const termFreq = new Map<string, number>();
      for (const token of doc.tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }

      for (const [term, frequency] of termFreq.entries()) {
        insertTermStmt.run(term);

        const termRow = termLookupStmt.get(term);
        if (!termRow) {
          continue;
        }

        insertPostingStmt.run(termRow.id, docId, frequency);
        incrementDfStmt.run(termRow.id);
      }
    }
  });

  transaction(processedDocs);

  console.log("Batch indexing complete.");
}
