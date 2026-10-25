import { Server } from "http";
import { config } from "./config/env";
import app from "./app";
import db from "./utils/db";
import { startCleanupJob } from "./jobs/cleanup.job";
import { logger } from "./utils/logger";
import { rankingProfile } from "./config/ranking";
import { lifecycle } from "./utils/lifecycle";
import { admission } from "./utils/admission";

const startupAbort = new AbortController();
let server: Server | undefined;
let cleanupTask: ReturnType<typeof startCleanupJob> | undefined;
let shuttingDown = false;
let httpClosePromise: Promise<void> | undefined;

const sleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));

const closeHttpServer = (): Promise<void> => {
  if (httpClosePromise) return httpClosePromise;

  httpClosePromise = new Promise<void>((resolve, reject) => {
    if (!server || !server.listening) return resolve();
    const closingServer = server;

    // close() only closes connections that are idle right now. A keep-alive
    // connection that finishes an in-flight request afterwards would otherwise
    // hold shutdown open until keepAliveTimeout and can hit the force deadline.
    const idleSweep = setInterval(() => closingServer.closeIdleConnections(), 50);
    idleSweep.unref();

    closingServer.close((err?: Error) => {
      clearInterval(idleSweep);
      if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        return reject(err);
      }
      resolve();
    });
    closingServer.closeIdleConnections();
  });

  return httpClosePromise;
};

const shutdown = async (signal: string, exitCode: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  startupAbort.abort();

  lifecycle.startDraining(signal);

  logger.info("shutdown_draining", {
    signal,
    drainDelayMs: config.SHUTDOWN_DRAIN_DELAY_MS,
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    activeRequests: lifecycle.snapshot().activeRequests,
  });

  const forceTimer = setTimeout(() => {
    logger.warn("shutdown_grace_period_exceeded", {
      timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
      activeRequests: lifecycle.snapshot().activeRequests,
    });
    void closeHttpServer().catch((err) =>
      logger.error("http_force_close_failed", { error: err }),
    );
    server?.closeAllConnections();
    // pool.end() waits for checked-out clients. A hung cleanup/query must not
    // keep this process alive beyond the configured termination deadline.
    process.exit(exitCode);
  }, config.SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => cleanupTask?.stop()),
      (async () => {
        // Readiness is already false; allow routing propagation while cleanup
        // drains independently, then stop accepting application connections.
        await sleep(config.SHUTDOWN_DRAIN_DELAY_MS);
        logger.info("shutdown_http_close_started", {
          signal, activeRequests: lifecycle.snapshot().activeRequests,
        });
        await closeHttpServer();
      })(),
    ]);
    try { await db.disconnect(); }
    catch (reason) { results.push({ status: "rejected", reason }); }
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    lifecycle.markStopped();
    logger.info("shutdown_completed", { signal });
  } finally {
    clearTimeout(forceTimer);
  }
};

const terminate = (signal: string, exitCode: number) => {
  if (shuttingDown) return;
  void shutdown(signal, exitCode)
    .catch((err) => { exitCode = 1; logger.error("shutdown_failed", { signal, error: err }); })
    .finally(() => process.exit(exitCode));
};

// Handlers cover connection retries as well as the serving phase.
    process.on("SIGTERM", () => terminate("SIGTERM", 0));
    process.on("SIGINT", () => terminate("SIGINT", 0));
    process.once("uncaughtException", (err) => {
      logger.error("uncaught_exception", { error: err });
      terminate("uncaughtException", 1);
    });
    process.once("unhandledRejection", (reason) => {
      logger.error("unhandled_rejection", { error: reason });
      terminate("unhandledRejection", 1);
    });

const main = async () => {
  try {
    await db.connect(undefined, undefined, startupAbort.signal);
    startupAbort.signal.throwIfAborted();
    cleanupTask = startCleanupJob();

    if (!config.CURSOR_SIGNING_SECRET) {
      logger.warn("cursor_signing_disabled", {
        requireSignature: config.CURSOR_REQUIRE_SIGNATURE,
        recommendation: "Set CURSOR_SIGNING_SECRET to enable tamper-resistant cursors",
      });
    } else if (!config.CURSOR_REQUIRE_SIGNATURE) {
      logger.info("cursor_unsigned_legacy_compatibility_enabled", {
        recommendation:
          "After existing cursor sessions expire, set CURSOR_REQUIRE_SIGNATURE=true",
      });
    }

    if (config.RATE_LIMIT_ENABLED && !config.HTTP_TRUST_PROXY) {
      logger.info("rate_limit_direct_client_ip_mode", {
        recommendation:
          "Enable HTTP_TRUST_PROXY only when traffic always arrives through a trusted reverse proxy",
      });
    }

    if (config.NODE_ENV === "production" && config.LOCATION_AUTH_MODE === "disabled") {
      logger.warn("location_auth_disabled", {
        recommendation:
          "Enable LOCATION_AUTH_MODE=bearer or enforce equivalent authenticated service identity at the proxy/service-mesh boundary",
      });
    }

    if (config.LOCATION_AUTH_PREVIOUS_TOKEN) {
      logger.info("location_auth_rotation_window_enabled", {
        recommendation:
          "Remove LOCATION_AUTH_PREVIOUS_TOKEN after callers have moved to the primary token",
      });
    }

    if (config.METRICS_AUTH_MODE === "disabled") {
      logger.info("metrics_auth_disabled", {
        recommendation:
          "Restrict /metrics with NetworkPolicy or enable METRICS_AUTH_MODE=bearer and configure the scraper to send the token",
      });
    }

    if (!config.PRIVACY_API_ENABLED) {
      logger.info("privacy_api_disabled");
    } else {
      logger.info("privacy_api_enabled", {
        recommendation:
          "Restrict /privacy to the trusted privacy/account-deletion workflow and stop upstream location publishing before erasure",
      });
    }

    if (config.PRIVACY_AUTH_PREVIOUS_TOKEN) {
      logger.info("privacy_auth_rotation_window_enabled", {
        recommendation:
          "Remove PRIVACY_AUTH_PREVIOUS_TOKEN after the privacy caller has moved to the primary token",
      });
    }

    server = app.listen(config.PORT, () => {
      lifecycle.markReady();
      const admissionSnapshot = admission.snapshot();
      logger.info("service_started", {
        port: config.PORT,
        swaggerEnabled: config.SWAGGER_ENABLED,
        swaggerTryItOutEnabled: config.SWAGGER_TRY_IT_OUT_ENABLED,
        rankingMode: rankingProfile.mode,
        rankingProfileId: rankingProfile.profileId,
        cursorSigningEnabled: Boolean(config.CURSOR_SIGNING_SECRET),
        cursorSignatureRequired: config.CURSOR_REQUIRE_SIGNATURE,
        locationAuthMode: config.LOCATION_AUTH_MODE,
        metricsAuthMode: config.METRICS_AUTH_MODE,
        privacyApiEnabled: config.PRIVACY_API_ENABLED,
        postgresApplicationName: config.PG_APPLICATION_NAME,
        cleanupBatchSize: config.CLEANUP_BATCH_SIZE,
        cleanupMaxBatchesPerRun: config.CLEANUP_MAX_BATCHES_PER_RUN,
        admissionEnabled: config.ADMISSION_ENABLED,
        nearbyMaxInFlight: config.NEARBY_MAX_IN_FLIGHT,
        upsertMaxInFlight: config.UPSERT_MAX_IN_FLIGHT,
        adaptiveAdmissionEnabled: config.ADAPTIVE_ADMISSION_ENABLED,
        adaptiveNearbyMinInFlight: config.ADAPTIVE_NEARBY_MIN_IN_FLIGHT,
        adaptiveUpsertMinInFlight: config.ADAPTIVE_UPSERT_MIN_IN_FLIGHT,
        adaptiveNearbyLatencyTargetMs: config.ADAPTIVE_NEARBY_LATENCY_TARGET_MS,
        adaptiveUpsertLatencyTargetMs: config.ADAPTIVE_UPSERT_LATENCY_TARGET_MS,
        adaptiveInitialLimitPercent: config.ADAPTIVE_INITIAL_LIMIT_PERCENT,
        adaptiveNearbyEffectiveLimit:
          admissionSnapshot.adaptive.nearby.effectiveLimit,
        adaptiveUpsertEffectiveLimit:
          admissionSnapshot.adaptive.upsert.effectiveLimit,
        poolWaitingRejectThreshold: config.PG_POOL_WAITING_REJECT_THRESHOLD,
        dbCircuitFailureThreshold: config.DB_CIRCUIT_FAILURE_THRESHOLD,
        dbCircuitOpenMs: config.DB_CIRCUIT_OPEN_MS,
        rateLimitEnabled: config.RATE_LIMIT_ENABLED,
        shutdownDrainDelayMs: config.SHUTDOWN_DRAIN_DELAY_MS,
        shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,
        startupMigrationsEnabled: config.RUN_MIGRATIONS_ON_STARTUP,
      });
    });
    server.once("error", (error) => { logger.error("listener_failed", { error }); terminate("listener_failure", 1); });

  } catch (err) {
    if (!shuttingDown) {
      logger.error("service_start_failed", { error: err });
      terminate("startup_failure", 1);
    }
  }
};

void main();
