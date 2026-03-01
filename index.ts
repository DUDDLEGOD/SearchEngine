import { config } from "./src/config";
import { db } from "./src/db";
import { startScheduler, stopScheduler } from "./src/ingestion/scheduler";
import { initDb } from "./src/initDb";
import { log } from "./src/logging";
import { warmSearchStats } from "./src/search";
import { startServer } from "./src/server";

initDb();
warmSearchStats();
const server = startServer(config.PORT);

if (config.ENABLE_SCHEDULER) {
  startScheduler(config.SCHED_INTERVAL_MS);
}

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  log("info", "server.shutdown.start", { signal });

  stopScheduler();
  server.stop();
  db.close(false);

  log("info", "server.shutdown.complete", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
