import { startScheduler } from "./src/ingestion/scheduler";
import { initDb } from "./src/initDb";
import { startServer } from "./src/server";

initDb();
startServer(3000);

// Run every 5 minutes
startScheduler(300000);
