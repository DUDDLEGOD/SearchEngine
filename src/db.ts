import { Database } from "bun:sqlite";

export const db = new Database("search.db", { create: true });
