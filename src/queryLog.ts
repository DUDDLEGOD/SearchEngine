import { db } from "./db";

type QueryIdRow = {
  id: number;
};

type QueryRow = {
  query: string;
};

export function recordQuery(query: string): { isNew: boolean } {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return { isNew: false };
  }

  const getQueryIdStmt = db.query<QueryIdRow, [string]>(
    "SELECT id FROM queries WHERE query = ?"
  );
  const upsertQueryStmt = db.query<unknown, [string]>(
    `INSERT INTO queries (query, hit_count, created_at, last_seen_at)
     VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(query) DO UPDATE SET
       hit_count = hit_count + 1,
       last_seen_at = CURRENT_TIMESTAMP`
  );

  const existing = getQueryIdStmt.get(normalizedQuery);
  const isNew = existing === null;

  upsertQueryStmt.run(normalizedQuery);

  return { isNew };
}

export function getTopQueries(limit: number): string[] {
  if (limit <= 0) {
    return [];
  }

  const topQueriesStmt = db.query<QueryRow, [number]>(
    `SELECT query
     FROM queries
     ORDER BY hit_count DESC, last_seen_at DESC
     LIMIT ?`
  );

  const rows = topQueriesStmt.all(limit);
  return rows.map((row) => row.query);
}
