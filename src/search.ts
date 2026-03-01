import { db } from "./db";
import { preprocess } from "./nlp";

type TotalDocsRow = {
  count: number;
};

type TermRow = {
  id: number;
  document_frequency: number;
};

type PostingRow = {
  document_id: number;
  term_frequency: number;
};

type DocLengthRow = {
  doc_length: number;
};

type DocFullRow = {
  title: string;
  url: string;
  clean_text: string;
};

export type SearchResult = {
  title: string;
  url: string;
  score: number;
};

const idfCache = new Map<string, number>();

const totalDocsStmt = db.query<TotalDocsRow, []>(
  "SELECT COUNT(*) as count FROM documents"
);

const termStmt = db.query<TermRow, [string]>(
  "SELECT id, document_frequency FROM terms WHERE term = ?"
);

const postingsStmt = db.query<PostingRow, [number]>(
  "SELECT document_id, term_frequency FROM inverted_index WHERE term_id = ?"
);

const docLengthStmt = db.query<DocLengthRow, [number]>(
  "SELECT doc_length FROM documents WHERE id = ?"
);

const docFullStmt = db.query<DocFullRow, [number]>(
  "SELECT title, url, clean_text FROM documents WHERE id = ?"
);

export async function search(query: string): Promise<SearchResult[]> {
  const startTime = performance.now();

  const rawQuery = query.trim().toLowerCase();
  if (!rawQuery) {
    return [];
  }

  const tokens = preprocess(rawQuery);
  if (tokens.length === 0) {
    return [];
  }

  const uniqueTokens = [...new Set(tokens)];
  const totalDocs = totalDocsStmt.get()?.count ?? 1;

  const scores = new Map<number, number>();

  for (const term of uniqueTokens) {
    const termRow = termStmt.get(term);
    if (!termRow) {
      continue;
    }

    let idf = idfCache.get(term);
    if (idf === undefined) {
      idf = Math.log(totalDocs / (termRow.document_frequency || 1));
      idfCache.set(term, idf);
    }

    const postings = postingsStmt.all(termRow.id);
    for (const posting of postings) {
      const docRow = docLengthStmt.get(posting.document_id);
      if (!docRow || docRow.doc_length <= 0) {
        continue;
      }

      const tf = posting.term_frequency / Math.sqrt(docRow.doc_length);
      const score = tf * idf;

      scores.set(posting.document_id, (scores.get(posting.document_id) ?? 0) + score);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const finalResults: SearchResult[] = [];
  for (const [docId, baseScore] of ranked) {
    const doc = docFullStmt.get(docId);
    if (!doc) {
      continue;
    }

    let boostedScore = baseScore;

    for (const token of uniqueTokens) {
      if (doc.title.toLowerCase().includes(token)) {
        boostedScore *= 1.3;
        break;
      }
    }

    if (doc.clean_text.toLowerCase().includes(rawQuery)) {
      boostedScore += 2;
    }

    finalResults.push({
      title: doc.title,
      url: doc.url,
      score: boostedScore,
    });
  }

  finalResults.sort((a, b) => b.score - a.score);

  const endTime = performance.now();
  console.log(`Search for "${query}" took ${(endTime - startTime).toFixed(2)}ms`);

  return finalResults;
}
