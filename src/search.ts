import natural from "natural";
import { db } from "./db";
import type { SourceName } from "./ingestion/types";
import { recordCacheHit, recordCacheMiss } from "./metrics";
import { preprocess } from "./nlp";
import { getQuerySuggestions } from "./queryLog";
import { getCachedCorpusStats, getCachedSearchResponse, setCachedCorpusStats, setCachedSearchResponse } from "./search/cache";
import { getSynonyms } from "./search/synonyms";
import type {
  LegacySearchResult,
  SearchRequest,
  SearchResponseV1,
  SearchResult,
} from "./types/api";

type CorpusStatsRow = {
  totalDocs: number;
  avgDocLength: number | null;
};

type TermRow = {
  id: number;
  document_frequency: number;
};

type PostingRow = {
  document_id: number;
  term_frequency: number;
};

type DocRow = {
  title: string;
  url: string;
  source: SourceName;
  raw_text: string | null;
  clean_text: string;
  published_at: string | null;
};

type PositionRow = {
  positions: string;
};

type ExpandedTerm = {
  term: string;
  weight: number;
  kind: "exact" | "synonym" | "typo";
};

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TITLE_BOOST = 1.5;
const PHRASE_BOOST = 1.5;
const PROXIMITY_BOOST = 0.5;
const TYPO_WEIGHT = 0.7;
const SYNONYM_WEIGHT = 0.6;

type SearchStatements = {
  corpusStatsStmt: ReturnType<typeof db.query<CorpusStatsRow, []>>;
  termStmt: ReturnType<typeof db.query<TermRow, [string]>>;
  postingsStmt: ReturnType<typeof db.query<PostingRow, [number]>>;
  docLengthStmt: ReturnType<typeof db.query<{ doc_length: number }, [number]>>;
  docStmt: ReturnType<typeof db.query<DocRow, [number]>>;
  positionStmt: ReturnType<typeof db.query<PositionRow, [number, number]>>;
  termPrefixStmt: ReturnType<typeof db.query<{ term: string }, [string, number]>>;
  dictionaryCandidatesStmt: ReturnType<
    typeof db.query<{ term: string }, [string, number]>
  >;
};

let statements: SearchStatements | null = null;

function getStatements(): SearchStatements {
  if (statements) {
    return statements;
  }

  statements = {
    corpusStatsStmt: db.query<CorpusStatsRow, []>(
      `SELECT
          COUNT(*) as totalDocs,
          AVG(COALESCE(doc_length, 0)) as avgDocLength
       FROM documents`
    ),
    termStmt: db.query<TermRow, [string]>(
      "SELECT id, document_frequency FROM terms WHERE term = ?"
    ),
    postingsStmt: db.query<PostingRow, [number]>(
      "SELECT document_id, term_frequency FROM inverted_index WHERE term_id = ?"
    ),
    docLengthStmt: db.query<{ doc_length: number }, [number]>(
      "SELECT doc_length FROM documents WHERE id = ?"
    ),
    docStmt: db.query<DocRow, [number]>(
      `SELECT title, url, source, raw_text, clean_text, published_at
       FROM documents
       WHERE id = ?`
    ),
    positionStmt: db.query<PositionRow, [number, number]>(
      "SELECT positions FROM term_positions WHERE term_id = ? AND document_id = ?"
    ),
    termPrefixStmt: db.query<{ term: string }, [string, number]>(
      `SELECT term
       FROM terms
       WHERE term LIKE ?
       ORDER BY document_frequency DESC
       LIMIT ?`
    ),
    dictionaryCandidatesStmt: db.query<{ term: string }, [string, number]>(
      `SELECT term
       FROM terms
       WHERE term LIKE ?
       ORDER BY document_frequency DESC
       LIMIT ?`
    ),
  };

  return statements;
}

function normalizeRawTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function getCorpusStats() {
  const statements = getStatements();
  const cached = getCachedCorpusStats();
  if (cached) {
    return cached;
  }

  const row = statements.corpusStatsStmt.get();
  const totalDocs = row?.totalDocs ?? 0;
  const avgDocLength = row?.avgDocLength && row.avgDocLength > 0 ? row.avgDocLength : 1;

  const stats = { totalDocs, avgDocLength };
  setCachedCorpusStats(stats);
  return stats;
}

export function warmSearchStats() {
  getCorpusStats();
}

function expandTerms(baseTerms: string[]): ExpandedTerm[] {
  const statements = getStatements();
  const expanded = new Map<string, ExpandedTerm>();

  for (const term of baseTerms) {
    expanded.set(term, { term, weight: 1, kind: "exact" });

    const synonyms = getSynonyms(term);
    for (const synonym of synonyms) {
      const normalized = preprocess(synonym)[0];
      if (!normalized || expanded.has(normalized)) {
        continue;
      }
      expanded.set(normalized, {
        term: normalized,
        weight: SYNONYM_WEIGHT,
        kind: "synonym",
      });
    }

    const firstChar = term[0];
    if (!firstChar) {
      continue;
    }

    const dictionaryCandidates = statements.dictionaryCandidatesStmt.all(`${firstChar}%`, 200);
    const typoMatches: string[] = [];
    for (const candidate of dictionaryCandidates) {
      if (candidate.term === term) {
        continue;
      }

      const distance = natural.LevenshteinDistance(term, candidate.term);
      if (distance <= 1) {
        typoMatches.push(candidate.term);
      }

      if (typoMatches.length >= 3) {
        break;
      }
    }

    for (const candidate of typoMatches) {
      if (expanded.has(candidate)) {
        continue;
      }
      expanded.set(candidate, { term: candidate, weight: TYPO_WEIGHT, kind: "typo" });
    }
  }

  return [...expanded.values()];
}

function parsePositions(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is number => typeof entry === "number");
  } catch {
    return [];
  }
}

function hasProximityMatch(positionsA: number[], positionsB: number[], maxGap: number): boolean {
  for (const posA of positionsA) {
    for (const posB of positionsB) {
      const distance = Math.abs(posA - posB);
      if (distance > 0 && distance <= maxGap) {
        return true;
      }
    }
  }

  return false;
}

function getProximityBoost(docId: number, baseTerms: string[], termIds: Map<string, number>): number {
  const statements = getStatements();
  if (baseTerms.length < 2) {
    return 0;
  }

  let boost = 0;
  for (let index = 0; index < baseTerms.length - 1; index += 1) {
    const a = baseTerms[index];
    const b = baseTerms[index + 1];
    if (!a || !b) {
      continue;
    }
    const termAId = termIds.get(a);
    const termBId = termIds.get(b);

    if (!termAId || !termBId) {
      continue;
    }

    const aRow = statements.positionStmt.get(termAId, docId);
    const bRow = statements.positionStmt.get(termBId, docId);
    if (!aRow || !bRow) {
      continue;
    }

    const positionsA = parsePositions(aRow.positions);
    const positionsB = parsePositions(bRow.positions);
    if (hasProximityMatch(positionsA, positionsB, 3)) {
      boost += PROXIMITY_BOOST;
    }
  }

  return boost;
}

function buildSnippet(text: string, queryTokens: string[]): { snippet: string; highlights: string[] } {
  const loweredText = text.toLowerCase();
  let focusIndex = -1;

  for (const token of queryTokens) {
    const index = loweredText.indexOf(token);
    if (index >= 0) {
      focusIndex = index;
      break;
    }
  }

  const snippetLength = 160;
  const start = focusIndex >= 0 ? Math.max(0, focusIndex - 60) : 0;
  const snippet = text.slice(start, start + snippetLength).trim();
  const highlights = [...new Set(queryTokens.filter((token) => loweredText.includes(token)))];

  return {
    snippet,
    highlights,
  };
}

function matchesFilters(
  doc: DocRow,
  filters: SearchRequest["filters"]
): boolean {
  if (filters.source && doc.source !== filters.source) {
    return false;
  }

  if (!filters.from && !filters.to) {
    return true;
  }

  if (!doc.published_at) {
    return false;
  }

  const publishedMs = Date.parse(doc.published_at);
  if (Number.isNaN(publishedMs)) {
    return false;
  }

  if (filters.from && publishedMs < filters.from.getTime()) {
    return false;
  }

  if (filters.to && publishedMs > filters.to.getTime()) {
    return false;
  }

  return true;
}

export async function searchV1(request: SearchRequest): Promise<SearchResponseV1> {
  const statements = getStatements();
  const normalizedQuery = request.query.trim();
  if (!normalizedQuery) {
    return {
      query: request.query,
      page: request.page,
      limit: request.limit,
      total: 0,
      totalPages: 0,
      results: [],
    };
  }

  const cacheKey = JSON.stringify({
    q: normalizedQuery.toLowerCase(),
    p: request.page,
    l: request.limit,
    s: request.filters.source ?? null,
    f: request.filters.from?.toISOString() ?? null,
    t: request.filters.to?.toISOString() ?? null,
  });

  const cached = getCachedSearchResponse(cacheKey);
  if (cached) {
    recordCacheHit();
    return cached;
  }
  recordCacheMiss();

  const queryTokens = preprocess(normalizedQuery);
  if (queryTokens.length === 0) {
    return {
      query: request.query,
      page: request.page,
      limit: request.limit,
      total: 0,
      totalPages: 0,
      results: [],
    };
  }

  const uniqueQueryTokens = [...new Set(queryTokens)];
  const rawTokens = normalizeRawTokens(normalizedQuery);
  const expandedTerms = expandTerms(uniqueQueryTokens);

  const { totalDocs, avgDocLength } = getCorpusStats();
  if (totalDocs === 0) {
    return {
      query: request.query,
      page: request.page,
      limit: request.limit,
      total: 0,
      totalPages: 0,
      results: [],
    };
  }

  const scores = new Map<number, number>();
  const exactTermIds = new Map<string, number>();

  for (const expandedTerm of expandedTerms) {
    const termRow = statements.termStmt.get(expandedTerm.term);
    if (!termRow) {
      continue;
    }

    if (expandedTerm.kind === "exact") {
      exactTermIds.set(expandedTerm.term, termRow.id);
    }

    const df = Math.max(termRow.document_frequency, 1);
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

    const postings = statements.postingsStmt.all(termRow.id);
    for (const posting of postings) {
      const docLength = statements.docLengthStmt.get(posting.document_id)?.doc_length ?? 1;
      const tf = posting.term_frequency;
      const denominator =
        tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / Math.max(avgDocLength, 1)));
      const bm25 = idf * ((tf * (BM25_K1 + 1)) / Math.max(denominator, 1e-6));
      const weighted = bm25 * expandedTerm.weight;

      scores.set(posting.document_id, (scores.get(posting.document_id) ?? 0) + weighted);
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const fullResults: SearchResult[] = [];

  for (const [docId, baseScore] of ranked) {
    const doc = statements.docStmt.get(docId);
    if (!doc || !matchesFilters(doc, request.filters)) {
      continue;
    }

    let score = baseScore;
    const titleLower = doc.title.toLowerCase();
    if (rawTokens.some((token) => titleLower.includes(token))) {
      score *= TITLE_BOOST;
    }

    const searchableText = (doc.raw_text ?? doc.clean_text).toLowerCase();
    if (searchableText.includes(normalizedQuery.toLowerCase())) {
      score += PHRASE_BOOST;
    }

    score += getProximityBoost(docId, uniqueQueryTokens, exactTermIds);

    const snippetSource = doc.raw_text ?? doc.clean_text;
    const { snippet, highlights } = buildSnippet(snippetSource, rawTokens);

    fullResults.push({
      title: doc.title,
      url: doc.url,
      source: doc.source,
      score: Number(score.toFixed(6)),
      snippet,
      highlights,
      publishedAt: doc.published_at,
    });
  }

  fullResults.sort((a, b) => b.score - a.score);

  const total = fullResults.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / request.limit);
  const offset = (request.page - 1) * request.limit;
  const paginated = fullResults.slice(offset, offset + request.limit);

  const response: SearchResponseV1 = {
    query: request.query,
    page: request.page,
    limit: request.limit,
    total,
    totalPages,
    results: paginated,
  };

  setCachedSearchResponse(cacheKey, response);
  return response;
}

export async function search(
  query: string,
  limit = 10,
  offset = 0
): Promise<LegacySearchResult[]> {
  const page = Math.floor(offset / Math.max(limit, 1)) + 1;
  const envelope = await searchV1({
    query,
    page,
    limit,
    filters: {},
  });

  return envelope.results.map((result) => ({
    title: result.title,
    url: result.url,
    score: result.score,
  }));
}

export async function suggest(query: string, limit: number): Promise<string[]> {
  const statements = getStatements();
  const normalized = query.trim().toLowerCase();
  if (!normalized || limit <= 0) {
    return [];
  }

  const fromHistory = getQuerySuggestions(normalized, limit);
  const fromTerms = statements.termPrefixStmt.all(
    `${preprocess(normalized)[0] ?? normalized}%`,
    limit
  );

  const combined = new Set<string>();
  for (const entry of fromHistory) {
    combined.add(entry);
    if (combined.size >= limit) {
      return [...combined];
    }
  }

  for (const entry of fromTerms) {
    combined.add(entry.term);
    if (combined.size >= limit) {
      return [...combined];
    }
  }

  return [...combined];
}
