export type AdmissionWorkload = "nearby" | "upsert";
export type AdmissionRejectReason =
  | "circuit_open"
  | "pool_queue"
  | "concurrency";
export type CircuitState = "closed" | "open" | "half_open";
export type AdaptiveAdjustmentReason = "latency" | "failure" | "pool_queue" | "recovery";
export type AdaptiveAdjustmentDirection = "increase" | "decrease";

export interface DatabaseErrorClassification {
  retryable: boolean;
  tripCircuit: boolean;
}

const transientPgCodes = new Set([
  "40001",
  "40P01",
  "53300",
  "53400",
  "55P03",
  "57014",
  "57P01",
  "57P02",
  "57P03",
  "58000",
  "58030",
]);

const circuitPgCodes = new Set([
  "53300",
  "53400",
  "57P01",
  "57P02",
  "57P03",
  "58000",
  "58030",
]);

/** PostgreSQL SQLSTATE classification used by the runtime adapter. */
export const classifyPgErrorCode = (code: string): DatabaseErrorClassification => {
  const connectionClass = code.startsWith("08");
  return {
    retryable: connectionClass || transientPgCodes.has(code),
    tripCircuit: connectionClass || circuitPgCodes.has(code),
  };
};

const connectionErrorCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE",
  "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EAI_AGAIN", "ENOTFOUND",
]);

// pg / pg-pool also emit connection errors without a SQLSTATE or Node code.
// Match their specific messages instead of treating arbitrary errors as outages.
const connectionErrorMessages = new Set([
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
  "Connection terminated",
  "Client was closed and is not queryable",
  "timeout expired",
]);

/** Classifies only errors from database operations, including wrapped failures. */
export const classifyDatabaseError = (
  error: unknown,
  depth = 0,
): DatabaseErrorClassification => {
  if (!error || typeof error !== "object" || depth > 4) {
    return { retryable: false, tripCircuit: false };
  }
  const { code, message, cause, errors } = error as {
    code?: unknown; message?: unknown; cause?: unknown; errors?: unknown;
  };
  const classification = classifyPgErrorCode(typeof code === "string" ? code : "");
  const connectionFailure =
    (typeof code === "string" && connectionErrorCodes.has(code)) ||
    (typeof message === "string" && connectionErrorMessages.has(message));
  const nested = [cause, ...(Array.isArray(errors) ? errors.slice(0, 16) : [])];
  for (const item of nested) {
    const result = classifyDatabaseError(item, depth + 1);
    classification.retryable ||= result.retryable;
    classification.tripCircuit ||= result.tripCircuit;
  }
  return {
    retryable: classification.retryable || connectionFailure || message === "Query read timeout",
    tripCircuit: classification.tripCircuit || connectionFailure,
  };
};

export interface AdmissionSettings {
  nearbyMaxInFlight: number;
  upsertMaxInFlight: number;
  poolWaitingRejectThreshold: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
}

export interface AdmissionSnapshot {
  circuitState: CircuitState;
  circuitFailureStreak: number;
  circuitOpenUntilMs: number | null;
  nearbyInFlight: number;
  upsertInFlight: number;
}

export type AdmissionDecision =
  | {
      accepted: true;
      release: () => void;
      probe: boolean;
    }
  | {
      accepted: false;
      reason: AdmissionRejectReason;
      retryAfterSeconds: number;
    };

export class AdmissionController {
  private readonly settings: AdmissionSettings;
  private nearbyInFlight = 0;
  private upsertInFlight = 0;
  private circuitState: CircuitState = "closed";
  private circuitFailureStreak = 0;
  private circuitOpenUntilMs = 0;
  private halfOpenProbeActive = false;

  constructor(settings: AdmissionSettings) {
    this.settings = settings;
  }

  tryAcquire(
    workload: AdmissionWorkload,
    poolWaitingCount: number,
    nowMs = Date.now(),
    maxInFlightOverride?: number,
  ): AdmissionDecision {
    if (this.circuitState === "open") {
      if (nowMs < this.circuitOpenUntilMs) {
        return {
          accepted: false,
          reason: "circuit_open",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((this.circuitOpenUntilMs - nowMs) / 1000),
          ),
        };
      }
      this.circuitState = "half_open";
      this.halfOpenProbeActive = false;
    }

    if (this.circuitState === "half_open" && this.halfOpenProbeActive) {
      return {
        accepted: false,
        reason: "circuit_open",
        retryAfterSeconds: 1,
      };
    }

    if (poolWaitingCount >= this.settings.poolWaitingRejectThreshold) {
      return {
        accepted: false,
        reason: "pool_queue",
        retryAfterSeconds: 1,
      };
    }

    const current =
      workload === "nearby" ? this.nearbyInFlight : this.upsertInFlight;
    const configuredMax =
      workload === "nearby"
        ? this.settings.nearbyMaxInFlight
        : this.settings.upsertMaxInFlight;
    const max = Math.max(
      1,
      Math.min(configuredMax, maxInFlightOverride ?? configuredMax),
    );

    if (current >= max) {
      return {
        accepted: false,
        reason: "concurrency",
        retryAfterSeconds: 1,
      };
    }

    if (workload === "nearby") this.nearbyInFlight += 1;
    else this.upsertInFlight += 1;

    const probe = this.circuitState === "half_open";
    if (probe) this.halfOpenProbeActive = true;

    let released = false;
    return {
      accepted: true,
      probe,
      release: () => {
        if (released) return;
        released = true;
        if (workload === "nearby") {
          this.nearbyInFlight = Math.max(0, this.nearbyInFlight - 1);
        } else {
          this.upsertInFlight = Math.max(0, this.upsertInFlight - 1);
        }
        // A half-open request that never reached the database (for example a
        // validation failure) must not permanently occupy the probe slot.
        if (probe && this.circuitState === "half_open") {
          this.halfOpenProbeActive = false;
        }
      },
    };
  }

  recordDbSuccess(): void {
    this.circuitFailureStreak = 0;
    this.circuitState = "closed";
    this.circuitOpenUntilMs = 0;
    this.halfOpenProbeActive = false;
  }

  recordDbFailure(retryable: boolean, nowMs = Date.now()): void {
    if (!retryable) return;

    if (this.circuitState === "half_open") {
      this.openCircuit(nowMs);
      return;
    }

    this.circuitFailureStreak += 1;
    if (this.circuitFailureStreak >= this.settings.circuitFailureThreshold) {
      this.openCircuit(nowMs);
    }
  }

  snapshot(nowMs = Date.now()): AdmissionSnapshot {
    let state = this.circuitState;
    if (state === "open" && nowMs >= this.circuitOpenUntilMs) {
      state = "half_open";
    }
    return {
      circuitState: state,
      circuitFailureStreak: this.circuitFailureStreak,
      circuitOpenUntilMs:
        this.circuitState === "open" ? this.circuitOpenUntilMs : null,
      nearbyInFlight: this.nearbyInFlight,
      upsertInFlight: this.upsertInFlight,
    };
  }

  private openCircuit(nowMs: number): void {
    this.circuitState = "open";
    this.circuitOpenUntilMs = nowMs + this.settings.circuitOpenMs;
    this.halfOpenProbeActive = false;
  }
}

export interface AdaptiveConcurrencySettings {
  enabled: boolean;
  nearbyConfiguredMax: number;
  upsertConfiguredMax: number;
  nearbyMin: number;
  upsertMin: number;
  nearbyLatencyTargetMs: number;
  upsertLatencyTargetMs: number;
  initialLimitPercent: number;
  ewmaAlpha: number;
  increaseEvery: number;
  decreaseFactor: number;
  decreaseCooldownMs: number;
}

interface AdaptiveWorkloadState {
  effectiveLimit: number;
  latencyEwmaMs: number | null;
  healthySamples: number;
  lastDecreaseAtMs: number;
}

export interface AdaptiveWorkloadSnapshot {
  effectiveLimit: number;
  configuredMax: number;
  minimum: number;
  latencyTargetMs: number;
  latencyEwmaMs: number | null;
}

export interface AdaptiveConcurrencySnapshot {
  enabled: boolean;
  nearby: AdaptiveWorkloadSnapshot;
  upsert: AdaptiveWorkloadSnapshot;
}

export interface AdaptiveAdjustment {
  workload: AdmissionWorkload;
  direction: AdaptiveAdjustmentDirection;
  reason: AdaptiveAdjustmentReason;
  previousLimit: number;
  effectiveLimit: number;
}

/**
 * Per-process adaptive concurrency controller.
 *
 * The configured admission limits remain hard upper bounds. When enabled, a
 * replica starts below those caps, increases additively after sustained healthy
 * DB latency, and decreases multiplicatively on DB latency/availability or pool
 * pressure. This intentionally converges slowly to avoid a new HPA replica
 * immediately adding its full configured concurrency to PostgreSQL.
 */
export class AdaptiveConcurrencyController {
  private readonly settings: AdaptiveConcurrencySettings;
  private readonly states: Record<AdmissionWorkload, AdaptiveWorkloadState>;

  constructor(settings: AdaptiveConcurrencySettings) {
    this.settings = settings;
    this.states = {
      nearby: this.initialState("nearby"),
      upsert: this.initialState("upsert"),
    };
  }

  effectiveLimit(workload: AdmissionWorkload): number {
    return this.settings.enabled
      ? this.states[workload].effectiveLimit
      : this.configuredMax(workload);
  }

  observeSuccess(
    workload: AdmissionWorkload,
    latencyMs: number,
    nowMs = Date.now(),
  ): AdaptiveAdjustment | null {
    if (!this.settings.enabled || !Number.isFinite(latencyMs) || latencyMs < 0) {
      return null;
    }

    const state = this.states[workload];
    state.latencyEwmaMs =
      state.latencyEwmaMs === null
        ? latencyMs
        : this.settings.ewmaAlpha * latencyMs +
          (1 - this.settings.ewmaAlpha) * state.latencyEwmaMs;

    const target = this.latencyTarget(workload);
    if (state.latencyEwmaMs > target) {
      state.healthySamples = 0;
      return this.decrease(workload, "latency", nowMs);
    }

    if (state.latencyEwmaMs <= target * 0.8) {
      state.healthySamples += 1;
      if (state.healthySamples >= this.settings.increaseEvery) {
        state.healthySamples = 0;
        return this.increase(workload);
      }
    } else {
      state.healthySamples = 0;
    }

    return null;
  }

  observeFailure(
    workload: AdmissionWorkload,
    latencyMs?: number,
    nowMs = Date.now(),
  ): AdaptiveAdjustment | null {
    if (!this.settings.enabled) return null;
    const state = this.states[workload];
    if (latencyMs !== undefined && Number.isFinite(latencyMs) && latencyMs >= 0) {
      state.latencyEwmaMs =
        state.latencyEwmaMs === null
          ? latencyMs
          : this.settings.ewmaAlpha * latencyMs +
            (1 - this.settings.ewmaAlpha) * state.latencyEwmaMs;
    }
    state.healthySamples = 0;
    return this.decrease(workload, "failure", nowMs);
  }

  observePoolPressure(
    workload: AdmissionWorkload,
    nowMs = Date.now(),
  ): AdaptiveAdjustment | null {
    if (!this.settings.enabled) return null;
    this.states[workload].healthySamples = 0;
    return this.decrease(workload, "pool_queue", nowMs);
  }

  snapshot(): AdaptiveConcurrencySnapshot {
    return {
      enabled: this.settings.enabled,
      nearby: this.snapshotWorkload("nearby"),
      upsert: this.snapshotWorkload("upsert"),
    };
  }

  private initialState(workload: AdmissionWorkload): AdaptiveWorkloadState {
    const configuredMax = this.configuredMax(workload);
    const minimum = this.minimum(workload);
    const initial = Math.max(
      minimum,
      Math.min(
        configuredMax,
        Math.floor(configuredMax * (this.settings.initialLimitPercent / 100)),
      ),
    );
    return {
      effectiveLimit: Math.max(1, initial),
      latencyEwmaMs: null,
      healthySamples: 0,
      lastDecreaseAtMs: Number.NEGATIVE_INFINITY,
    };
  }

  private increase(workload: AdmissionWorkload): AdaptiveAdjustment | null {
    const state = this.states[workload];
    const previousLimit = state.effectiveLimit;
    state.effectiveLimit = Math.min(
      this.configuredMax(workload),
      state.effectiveLimit + 1,
    );
    if (state.effectiveLimit === previousLimit) return null;
    return {
      workload,
      direction: "increase",
      reason: "recovery",
      previousLimit,
      effectiveLimit: state.effectiveLimit,
    };
  }

  private decrease(
    workload: AdmissionWorkload,
    reason: Exclude<AdaptiveAdjustmentReason, "recovery">,
    nowMs: number,
  ): AdaptiveAdjustment | null {
    const state = this.states[workload];
    if (nowMs - state.lastDecreaseAtMs < this.settings.decreaseCooldownMs) {
      return null;
    }

    const previousLimit = state.effectiveLimit;
    state.effectiveLimit = Math.max(
      this.minimum(workload),
      Math.floor(state.effectiveLimit * this.settings.decreaseFactor),
    );
    state.lastDecreaseAtMs = nowMs;
    if (state.effectiveLimit === previousLimit) return null;
    return {
      workload,
      direction: "decrease",
      reason,
      previousLimit,
      effectiveLimit: state.effectiveLimit,
    };
  }

  private configuredMax(workload: AdmissionWorkload): number {
    return workload === "nearby"
      ? this.settings.nearbyConfiguredMax
      : this.settings.upsertConfiguredMax;
  }

  private minimum(workload: AdmissionWorkload): number {
    return workload === "nearby"
      ? this.settings.nearbyMin
      : this.settings.upsertMin;
  }

  private latencyTarget(workload: AdmissionWorkload): number {
    return workload === "nearby"
      ? this.settings.nearbyLatencyTargetMs
      : this.settings.upsertLatencyTargetMs;
  }

  private snapshotWorkload(workload: AdmissionWorkload): AdaptiveWorkloadSnapshot {
    const state = this.states[workload];
    return {
      effectiveLimit: this.effectiveLimit(workload),
      configuredMax: this.configuredMax(workload),
      minimum: this.minimum(workload),
      latencyTargetMs: this.latencyTarget(workload),
      latencyEwmaMs: state.latencyEwmaMs,
    };
  }
}

interface RateEntry {
  windowStartedAtMs: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Bounded, per-process fixed-window limiter. It is intentionally small and
 * dependency-free; use an API gateway/Redis-based limiter for global limits.
 */
export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateEntry>();
  private operations = 0;

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  consume(
    key: string,
    limit: number,
    nowMs = Date.now(),
  ): RateLimitDecision {
    this.operations += 1;
    if (this.operations % 256 === 0) this.pruneExpired(nowMs);

    let entry = this.entries.get(key);
    if (!entry || nowMs - entry.windowStartedAtMs >= this.windowMs) {
      if (!entry && this.entries.size >= this.maxKeys) {
        this.evictOldest();
      }
      entry = { windowStartedAtMs: nowMs, count: 0 };
      this.entries.set(key, entry);
    }

    if (entry.count >= limit) {
      const retryMs = Math.max(
        1,
        this.windowMs - (nowMs - entry.windowStartedAtMs),
      );
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
      };
    }

    entry.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: 0,
    };
  }

  private pruneExpired(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.windowStartedAtMs >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }

  private evictOldest(): void {
    const oldestKey = this.entries.keys().next().value as string | undefined;
    if (oldestKey !== undefined) this.entries.delete(oldestKey);
  }
}
