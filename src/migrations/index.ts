import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";

type Migration = {
  version: string;
  file: string;
};

const migrations: Migration[] = [
  { version: "0001_baseline", file: "0001_baseline.sql" },
  { version: "0002_relevance_and_ingestion", file: "0002_relevance_and_ingestion.sql" },
];

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function isIgnorableMigrationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("duplicate column name") ||
    message.includes("already exists")
  );
}

export function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const hasMigrationStmt = db.query<{ version: string }, [string]>(
    "SELECT version FROM schema_migrations WHERE version = ?"
  );
  const markMigrationStmt = db.query<unknown, [string]>(
    "INSERT INTO schema_migrations(version, applied_at) VALUES(?, CURRENT_TIMESTAMP)"
  );

  for (const migration of migrations) {
    const alreadyApplied = hasMigrationStmt.get(migration.version);
    if (alreadyApplied) {
      continue;
    }

    const path = join(import.meta.dir, migration.file);
    const content = readFileSync(path, "utf8");
    const statements = splitSqlStatements(content);

    for (const statement of statements) {
      try {
        db.exec(statement);
      } catch (error) {
        if (!isIgnorableMigrationError(error)) {
          throw error;
        }
      }
    }

    markMigrationStmt.run(migration.version);
  }
}
