import cron from "node-cron";
import { config } from "../config/env";
import Location from "../models/location.model";
import db from "../utils/db";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { lifecycle } from "../utils/lifecycle";

// Stable two-int PostgreSQL advisory-lock namespace for this service/job.
// Session-level locking ensures only one replica performs cleanup at a time.
const CLEANUP_LOCK_NAMESPACE = 1_314_089_057;
const CLEANUP_LOCK_ID = 1;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Postgres has no equivalent of MongoDB's TTL indexes, so stale-location
 * cleanup is handled here on a schedule instead. Query-time stale filtering
 * preserves correctness even between cleanup runs.
 */
export const startCleanupJob = () => {
  if (!cron.validate(config.CLEANUP_CRON_SCHEDULE)) {
    throw new Error(
      `Invalid CLEANUP_CRON_SCHEDULE: ${config.CLEANUP_CRON_SCHEDULE}`,
    );
  }

  // This mutex prevents overlap inside one process. The advisory lock below is
  // the cross-replica guard and remains the source of truth in a deployment.
  let cleanupRunning = false;
  let stopped = false;
  let activeRun: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;

  const performCleanup = async () => {
    if (stopped || lifecycle.isDraining()) return;
    if (cleanupRunning) {
      metrics.recordCleanupRun("skipped_local", 0, 0);
      logger.warn("cleanup_skipped_already_running");
      return;
    }
    cleanupRunning = true;
    const startedAt = process.hrtime.bigint();

    try {
      const lockResult = await db.withAdvisoryLock(
        CLEANUP_LOCK_NAMESPACE,
        CLEANUP_LOCK_ID,
        async (client) => {
          let totalDeleted = 0;
          let batches = 0;
          let reachedRunLimit = false;

          while (!stopped && !lifecycle.isDraining() && batches < config.CLEANUP_MAX_BATCHES_PER_RUN) {
            const deleted = await Location.deleteStaleLocations(
              config.LOCATION_TTL_DAYS,
              config.CLEANUP_BATCH_SIZE,
              client,
            );
            totalDeleted += deleted;
            batches += 1;

            if (deleted < config.CLEANUP_BATCH_SIZE) break;

            if (batches >= config.CLEANUP_MAX_BATCHES_PER_RUN) {
              reachedRunLimit = true;
              break;
            }

            if (config.CLEANUP_BATCH_DELAY_MS > 0) {
              await sleep(config.CLEANUP_BATCH_DELAY_MS);
            }
          }

          return { totalDeleted, batches, reachedRunLimit: reachedRunLimit || lifecycle.isDraining() };
        },
      );

      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

      if (!lockResult.acquired) {
        metrics.recordCleanupRun("skipped_lock", 0, durationSeconds);
        logger.info("cleanup_skipped_advisory_lock", {
          durationMs: Number((durationSeconds * 1000).toFixed(2)),
        });
        return;
      }

      const result = lockResult.value!;
      metrics.recordCleanupDeleted(result.totalDeleted);
      metrics.recordCleanupRun(
        result.reachedRunLimit ? "partial" : "completed",
        result.batches,
        durationSeconds,
      );

      logger.info("cleanup_completed", {
        totalDeleted: result.totalDeleted,
        batches: result.batches,
        reachedRunLimit: result.reachedRunLimit,
        durationMs: Number((durationSeconds * 1000).toFixed(2)),
      });
    } catch (err) {
      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      metrics.recordCleanupRun("error", 0, durationSeconds);
      metrics.recordDbError();
      logger.error("cleanup_failed", { error: err });
    } finally {
      cleanupRunning = false;
    }
  };

  const runCleanup = () => activeRun ??= performCleanup().finally(() => { activeRun = undefined; });
  const task = cron.schedule(config.CLEANUP_CRON_SCHEDULE, runCleanup);
  void runCleanup();
  const stop = (): Promise<void> => {
    stopped = true;
    return stopping ??= (async () => {
      try { await task.stop(); }
      finally { try { await activeRun; } finally { await task.destroy(); } }
    })();
  };
  return { stop, destroy: stop };

};
