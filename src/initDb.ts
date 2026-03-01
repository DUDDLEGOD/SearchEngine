import { runMigrations } from "./migrations";

export function initDb() {
  runMigrations();
  console.log("Database initialized.");
}
