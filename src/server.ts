import { loadConfig } from "./config/env";
import { createApp } from "./app";
import { createDatabase } from "./utils/db";
import { LocationRepository } from "./models/location.model";
import { startCleanupJob } from "./jobs/cleanup.job";
import { createService, runService } from "./runtime";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const database = createDatabase(config);
  const locations = new LocationRepository(database.pool, config.LOCATION_TTL_DAYS);
  try {
    const app = createApp({ config, database, locations });
    await runService(createService({ app, port: config.PORT, database,
      startCleanup: () => startCleanupJob(config, locations) }));
  } catch (error) {
    try { await database.disconnect(); }
    catch (cleanupError) { console.error("Startup shutdown failed:", cleanupError); }
    throw error;
  }
};

void main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exitCode = 1;
});
