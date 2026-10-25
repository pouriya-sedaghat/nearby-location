import { config } from "../config/env";
import { pool } from "./db";
import { metrics } from "./metrics";
import {
  AdaptiveAdjustment,
  AdaptiveConcurrencyController,
  AdmissionController,
  AdmissionWorkload,
  FixedWindowRateLimiter,
  classifyDatabaseError,
} from "./admission-core";

const controller = new AdmissionController({
  nearbyMaxInFlight: config.NEARBY_MAX_IN_FLIGHT,
  upsertMaxInFlight: config.UPSERT_MAX_IN_FLIGHT,
  poolWaitingRejectThreshold: config.PG_POOL_WAITING_REJECT_THRESHOLD,
  circuitFailureThreshold: config.DB_CIRCUIT_FAILURE_THRESHOLD,
  circuitOpenMs: config.DB_CIRCUIT_OPEN_MS,
});

const adaptive = new AdaptiveConcurrencyController({
  enabled: config.ADAPTIVE_ADMISSION_ENABLED,
  nearbyConfiguredMax: config.NEARBY_MAX_IN_FLIGHT,
  upsertConfiguredMax: config.UPSERT_MAX_IN_FLIGHT,
  nearbyMin: config.ADAPTIVE_NEARBY_MIN_IN_FLIGHT,
  upsertMin: config.ADAPTIVE_UPSERT_MIN_IN_FLIGHT,
  nearbyLatencyTargetMs: config.ADAPTIVE_NEARBY_LATENCY_TARGET_MS,
  upsertLatencyTargetMs: config.ADAPTIVE_UPSERT_LATENCY_TARGET_MS,
  initialLimitPercent: config.ADAPTIVE_INITIAL_LIMIT_PERCENT,
  ewmaAlpha: config.ADAPTIVE_EWMA_ALPHA,
  increaseEvery: config.ADAPTIVE_INCREASE_EVERY,
  decreaseFactor: config.ADAPTIVE_DECREASE_FACTOR,
  decreaseCooldownMs: config.ADAPTIVE_DECREASE_COOLDOWN_MS,
});

const limiter = new FixedWindowRateLimiter(
  config.RATE_LIMIT_WINDOW_MS,
  config.RATE_LIMIT_MAX_KEYS,
);

export const isRetryableDatabaseError = (err: unknown): boolean =>
  classifyDatabaseError(err).retryable;

const shouldTripDatabaseCircuit = (err: unknown): boolean =>
  classifyDatabaseError(err).tripCircuit;

const recordAdjustment = (adjustment: AdaptiveAdjustment | null) => {
  if (!adjustment) return;
  metrics.recordAdaptiveAdjustment(
    adjustment.workload,
    adjustment.direction,
    adjustment.reason,
  );
};

const combinedSnapshot = () => ({
  ...controller.snapshot(),
  adaptive: adaptive.snapshot(),
});

const syncMetrics = () => metrics.setAdmissionSnapshot(combinedSnapshot());

export const admission = {
  tryAcquire(workload: AdmissionWorkload) {
    if (!config.ADMISSION_ENABLED) {
      return {
        accepted: true as const,
        probe: false,
        release: () => undefined,
      };
    }

    const decision = controller.tryAcquire(
      workload,
      pool.waitingCount,
      Date.now(),
      adaptive.effectiveLimit(workload),
    );

    if (!decision.accepted && decision.reason === "pool_queue") {
      recordAdjustment(adaptive.observePoolPressure(workload));
    }

    syncMetrics();
    if (!decision.accepted) return decision;

    const release = decision.release;
    return {
      ...decision,
      release: () => {
        release();
        syncMetrics();
      },
    };
  },

  consumeRateLimit(workload: AdmissionWorkload, clientKey: string) {
    if (!config.RATE_LIMIT_ENABLED) {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
    }
    const limit =
      workload === "nearby"
        ? config.RATE_LIMIT_NEARBY_MAX
        : config.RATE_LIMIT_UPSERT_MAX;
    return limiter.consume(`${workload}:${clientKey}`, limit);
  },

  recordDbSuccess(workload?: AdmissionWorkload, latencyMs?: number) {
    controller.recordDbSuccess();
    if (workload && latencyMs !== undefined) {
      metrics.observeDbOperation(workload, "success", latencyMs / 1000);
      recordAdjustment(adaptive.observeSuccess(workload, latencyMs));
    }
    syncMetrics();
  },

  recordDbFailure(
    err: unknown,
    workload?: AdmissionWorkload,
    latencyMs?: number,
  ): boolean {
    const retryable = isRetryableDatabaseError(err);
    controller.recordDbFailure(shouldTripDatabaseCircuit(err));
    if (workload && latencyMs !== undefined) {
      metrics.observeDbOperation(workload, "error", latencyMs / 1000);
      if (retryable) {
        recordAdjustment(adaptive.observeFailure(workload, latencyMs));
      }
    }
    syncMetrics();
    return retryable;
  },

  snapshot() {
    return combinedSnapshot();
  },
};

syncMetrics();
