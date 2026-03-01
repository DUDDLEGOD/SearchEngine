import { ingest } from "./orchestrator";
import { getTopQueries } from "../queryLog";

const FALLBACK_QUERIES = ["search engine", "machine learning"];

let intervalId: ReturnType<typeof setInterval> | null = null;

async function runSchedulerCycle() {
  const trackedQueries = getTopQueries(5);
  const queriesToIngest = trackedQueries.length > 0 ? trackedQueries : FALLBACK_QUERIES;

  for (const query of queriesToIngest) {
    try {
      await ingest(query);
    } catch (error) {
      console.error(`Scheduler ingestion failed for "${query}":`, error);
    }
  }
}

export function startScheduler(intervalMs: number) {
  if (intervalId) return;

  console.log("Ingestion scheduler started.");

  intervalId = setInterval(() => {
    void runSchedulerCycle();
  }, intervalMs);
}
