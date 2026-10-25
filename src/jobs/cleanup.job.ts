import cron from "node-cron";
import type { AppConfig } from "../config/env";
import type { LocationRepository } from "../models/location.model";
import type { Logger } from "../utils/logger";

export interface CleanupTask { stop(): Promise<void>; }
type Schedule = (expression: string, run: () => Promise<void>) => {
  stop(): void | Promise<void>;
  destroy(): void | Promise<void>;
};

/** One owned schedule, one active pass, bounded batches and awaited disposal. */
export const startCleanupJob = (
  config: AppConfig,
  locations: Pick<LocationRepository, "deleteStaleLocations">,
  logger: Logger = console,
  schedule: Schedule = cron.schedule,
): CleanupTask => {
  if (!cron.validate(config.CLEANUP_CRON_SCHEDULE)) {
    throw new Error(`Invalid CLEANUP_CRON_SCHEDULE: ${config.CLEANUP_CRON_SCHEDULE}`);
  }
  let stopping = false;
  let activeRun: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  const runCleanup = (): Promise<void> => {
    if (stopping) return Promise.resolve();
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        let totalDeleted = 0;
        while (!stopping) {
          const deleted = await locations.deleteStaleLocations(config.CLEANUP_BATCH_SIZE);
          totalDeleted += deleted;
          if (deleted < config.CLEANUP_BATCH_SIZE) break;
        }
        if (totalDeleted > 0) logger.log(`Cleanup job removed ${totalDeleted} stale location(s) in batches`);
      } catch (error) {
        logger.error("Cleanup job failed", error);
      }
    })().finally(() => { activeRun = undefined; });
    return activeRun;
  };
  const task = schedule(config.CLEANUP_CRON_SCHEDULE, runCleanup);
  void runCleanup();
  return {
    stop: () => {
      stopping = true;
      stopPromise ??= (async () => {
        try { await task.stop(); }
        finally {
          try { await activeRun; }
          finally { await task.destroy(); }
        }
      })();
      return stopPromise;
    },
  };
};
