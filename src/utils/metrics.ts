import { config } from "../config/env";
import { pool } from "./db";

type LabelSet = Record<string, string>;

const durationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

interface HistogramMetric {
  labels: LabelSet;
  count: number;
  durationSumSeconds: number;
  buckets: number[];
}

const httpMetrics = new Map<string, HistogramMetric>();
const dbOperationMetrics = new Map<string, HistogramMetric>();
const nearbySearches = new Map<string, number>();
const nearbyResults = new Map<string, number>();
const cursorValidationFailures = new Map<string, number>();
const authFailures = new Map<string, number>();
const privacyDeletions = new Map<string, number>();
const cleanupRuns = new Map<string, number>();
let cleanupDeletedTotal = 0;
let cleanupBatchesTotal = 0;
let cleanupDurationSecondsSum = 0;
let cleanupDurationCount = 0;
let dbErrorsTotal = 0;
const admissionRejections = new Map<string, number>();
const rateLimitRejections = new Map<string, number>();
const adaptiveAdjustments = new Map<string, number>();
let admissionCircuitState = 0;
let admissionFailureStreak = 0;
let admissionNearbyInFlight = 0;
let admissionUpsertInFlight = 0;
let admissionNearbyEffectiveLimit = config.NEARBY_MAX_IN_FLIGHT;
let admissionUpsertEffectiveLimit = config.UPSERT_MAX_IN_FLIGHT;
let admissionNearbyLatencyEwmaMs = 0;
let admissionUpsertLatencyEwmaMs = 0;
let admissionNearbyLatencyTargetMs = config.ADAPTIVE_NEARBY_LATENCY_TARGET_MS;
let admissionUpsertLatencyTargetMs = config.ADAPTIVE_UPSERT_LATENCY_TARGET_MS;
let adaptiveAdmissionEnabled = config.ADAPTIVE_ADMISSION_ENABLED ? 1 : 0;
let lifecycleState = 0;
let lifecycleActiveRequests = 0;

const labelKey = (labels: LabelSet) =>
  Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");

const escapeLabel = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

const renderLabels = (labels: LabelSet) => {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(",")}}`;
};

const observeHistogram = (
  store: Map<string, HistogramMetric>,
  labels: LabelSet,
  durationSeconds: number,
) => {
  const key = labelKey(labels);
  const metric =
    store.get(key) ?? {
      labels,
      count: 0,
      durationSumSeconds: 0,
      buckets: durationBuckets.map(() => 0),
    };

  metric.count += 1;
  metric.durationSumSeconds += durationSeconds;
  durationBuckets.forEach((bucket, index) => {
    if (durationSeconds <= bucket) metric.buckets[index] += 1;
  });
  store.set(key, metric);
};

const renderHistogram = (
  lines: string[],
  metricName: string,
  help: string,
  store: Map<string, HistogramMetric>,
) => {
  lines.push(`# HELP ${metricName} ${help}`, `# TYPE ${metricName} histogram`);
  for (const metric of store.values()) {
    durationBuckets.forEach((bucket, index) => {
      lines.push(
        `${metricName}_bucket${renderLabels({ ...metric.labels, le: String(bucket) })} ${metric.buckets[index]}`,
      );
    });
    lines.push(
      `${metricName}_bucket${renderLabels({ ...metric.labels, le: "+Inf" })} ${metric.count}`,
      `${metricName}_sum${renderLabels(metric.labels)} ${metric.durationSumSeconds}`,
      `${metricName}_count${renderLabels(metric.labels)} ${metric.count}`,
    );
  }
};

export const metrics = {
  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ) {
    observeHistogram(
      httpMetrics,
      { method: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "CONNECT", "TRACE"].includes(method) ? method : "OTHER",
        route: ["/health/live", "/health/ready", "/location/upsert", "/location/nearby", "/privacy/location/delete", "/privacy/location/delete-exact", "/metrics"].includes(route) ? route : "/not_found", status: String(statusCode) },
      durationSeconds,
    );
  },

  observeDbOperation(
    workload: "nearby" | "upsert" | "privacy",
    outcome: "success" | "error",
    durationSeconds: number,
  ) {
    observeHistogram(dbOperationMetrics, { workload, outcome }, durationSeconds);
  },

  recordNearbySearch(
    mode: "offset" | "cursor",
    rankingMode: "legacy" | "decay",
    resultCount: number,
  ) {
    const key = `${mode}|${rankingMode}`;
    nearbySearches.set(key, (nearbySearches.get(key) ?? 0) + 1);
    nearbyResults.set(key, (nearbyResults.get(key) ?? 0) + resultCount);
  },

  recordCursorValidationFailure(reason: string) {
    cursorValidationFailures.set(
      reason,
      (cursorValidationFailures.get(reason) ?? 0) + 1,
    );
  },

  recordAuthFailure(surface: string, reason: string) {
    const key = `${surface}|${reason}`;
    authFailures.set(key, (authFailures.get(key) ?? 0) + 1);
  },

  recordPrivacyDeletion(outcome: "deleted" | "not_found" | "error") {
    privacyDeletions.set(outcome, (privacyDeletions.get(outcome) ?? 0) + 1);
  },

  recordCleanupDeleted(count: number) {
    cleanupDeletedTotal += count;
  },

  recordCleanupRun(status: string, batches: number, durationSeconds: number) {
    cleanupRuns.set(status, (cleanupRuns.get(status) ?? 0) + 1);
    cleanupBatchesTotal += batches;
    cleanupDurationSecondsSum += durationSeconds;
    cleanupDurationCount += 1;
  },

  recordDbError() {
    dbErrorsTotal += 1;
  },

  recordAdmissionRejection(workload: string, reason: string) {
    const key = `${workload}|${reason}`;
    admissionRejections.set(key, (admissionRejections.get(key) ?? 0) + 1);
  },

  recordRateLimitRejection(workload: string) {
    rateLimitRejections.set(
      workload,
      (rateLimitRejections.get(workload) ?? 0) + 1,
    );
  },

  recordAdaptiveAdjustment(
    workload: string,
    direction: string,
    reason: string,
  ) {
    const key = `${workload}|${direction}|${reason}`;
    adaptiveAdjustments.set(key, (adaptiveAdjustments.get(key) ?? 0) + 1);
  },

  setLifecycleSnapshot(snapshot: {
    state: "starting" | "ready" | "draining" | "stopped";
    activeRequests: number;
  }) {
    lifecycleState =
      snapshot.state === "starting"
        ? 0
        : snapshot.state === "ready"
          ? 1
          : snapshot.state === "draining"
            ? 2
            : 3;
    lifecycleActiveRequests = snapshot.activeRequests;
  },

  setAdmissionSnapshot(snapshot: {
    circuitState: "closed" | "open" | "half_open";
    circuitFailureStreak: number;
    nearbyInFlight: number;
    upsertInFlight: number;
    adaptive?: {
      enabled: boolean;
      nearby: {
        effectiveLimit: number;
        latencyTargetMs: number;
        latencyEwmaMs: number | null;
      };
      upsert: {
        effectiveLimit: number;
        latencyTargetMs: number;
        latencyEwmaMs: number | null;
      };
    };
  }) {
    admissionCircuitState =
      snapshot.circuitState === "closed"
        ? 0
        : snapshot.circuitState === "half_open"
          ? 1
          : 2;
    admissionFailureStreak = snapshot.circuitFailureStreak;
    admissionNearbyInFlight = snapshot.nearbyInFlight;
    admissionUpsertInFlight = snapshot.upsertInFlight;

    if (snapshot.adaptive) {
      adaptiveAdmissionEnabled = snapshot.adaptive.enabled ? 1 : 0;
      admissionNearbyEffectiveLimit = snapshot.adaptive.nearby.effectiveLimit;
      admissionUpsertEffectiveLimit = snapshot.adaptive.upsert.effectiveLimit;
      admissionNearbyLatencyTargetMs = snapshot.adaptive.nearby.latencyTargetMs;
      admissionUpsertLatencyTargetMs = snapshot.adaptive.upsert.latencyTargetMs;
      admissionNearbyLatencyEwmaMs = snapshot.adaptive.nearby.latencyEwmaMs ?? 0;
      admissionUpsertLatencyEwmaMs = snapshot.adaptive.upsert.latencyEwmaMs ?? 0;
    }
  },

  renderPrometheus(): string {
    const lines: string[] = [
      "# HELP nearby_http_requests_total Total HTTP requests handled.",
      "# TYPE nearby_http_requests_total counter",
    ];

    for (const metric of httpMetrics.values()) {
      lines.push(
        `nearby_http_requests_total${renderLabels(metric.labels)} ${metric.count}`,
      );
    }

    renderHistogram(
      lines,
      "nearby_http_request_duration_seconds",
      "HTTP request duration in seconds.",
      httpMetrics,
    );
    renderHistogram(
      lines,
      "nearby_db_operation_duration_seconds",
      "PostgreSQL operation duration by location workload and outcome.",
      dbOperationMetrics,
    );

    lines.push(
      "# HELP nearby_searches_total Total nearby searches by pagination and ranking mode.",
      "# TYPE nearby_searches_total counter",
    );
    for (const [key, count] of nearbySearches.entries()) {
      const [mode, ranking] = key.split("|");
      lines.push(
        `nearby_searches_total${renderLabels({ mode, ranking })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_search_results_total Total nearby rows returned by pagination and ranking mode.",
      "# TYPE nearby_search_results_total counter",
    );
    for (const [key, count] of nearbyResults.entries()) {
      const [mode, ranking] = key.split("|");
      lines.push(
        `nearby_search_results_total${renderLabels({ mode, ranking })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_cursor_validation_failures_total Rejected nearby cursors by validation reason.",
      "# TYPE nearby_cursor_validation_failures_total counter",
    );
    for (const [reason, count] of cursorValidationFailures.entries()) {
      lines.push(
        `nearby_cursor_validation_failures_total${renderLabels({ reason })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_auth_failures_total Authentication failures by protected surface and reason.",
      "# TYPE nearby_auth_failures_total counter",
    );
    for (const [key, count] of authFailures.entries()) {
      const [surface, reason] = key.split("|");
      lines.push(
        `nearby_auth_failures_total${renderLabels({ surface, reason })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_privacy_location_deletions_total Privacy live-location erasure requests by internal outcome.",
      "# TYPE nearby_privacy_location_deletions_total counter",
    );
    for (const [outcome, count] of privacyDeletions.entries()) {
      lines.push(
        `nearby_privacy_location_deletions_total${renderLabels({ outcome })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_cleanup_runs_total Cleanup runs by outcome.",
      "# TYPE nearby_cleanup_runs_total counter",
    );
    for (const [status, count] of cleanupRuns.entries()) {
      lines.push(
        `nearby_cleanup_runs_total${renderLabels({ status })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_admission_rejections_total Requests rejected by overload admission control.",
      "# TYPE nearby_admission_rejections_total counter",
    );
    for (const [key, count] of admissionRejections.entries()) {
      const [workload, reason] = key.split("|");
      lines.push(
        `nearby_admission_rejections_total${renderLabels({ workload, reason })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_rate_limit_rejections_total Requests rejected by the optional per-replica rate limiter.",
      "# TYPE nearby_rate_limit_rejections_total counter",
    );
    for (const [workload, count] of rateLimitRejections.entries()) {
      lines.push(
        `nearby_rate_limit_rejections_total${renderLabels({ workload })} ${count}`,
      );
    }

    lines.push(
      "# HELP nearby_admission_adaptive_adjustments_total Adaptive concurrency limit changes by workload, direction and reason.",
      "# TYPE nearby_admission_adaptive_adjustments_total counter",
    );
    for (const [key, count] of adaptiveAdjustments.entries()) {
      const [workload, direction, reason] = key.split("|");
      lines.push(
        `nearby_admission_adaptive_adjustments_total${renderLabels({ workload, direction, reason })} ${count}`,
      );
    }

    const nearbyUtilization =
      admissionNearbyEffectiveLimit > 0
        ? admissionNearbyInFlight / admissionNearbyEffectiveLimit
        : 0;
    const upsertUtilization =
      admissionUpsertEffectiveLimit > 0
        ? admissionUpsertInFlight / admissionUpsertEffectiveLimit
        : 0;

    lines.push(
      "# HELP nearby_admission_circuit_state Admission circuit state: 0=closed, 1=half_open, 2=open.",
      "# TYPE nearby_admission_circuit_state gauge",
      `nearby_admission_circuit_state ${admissionCircuitState}`,
      "# HELP nearby_admission_db_failure_streak Consecutive DB availability failures seen by admission control.",
      "# TYPE nearby_admission_db_failure_streak gauge",
      `nearby_admission_db_failure_streak ${admissionFailureStreak}`,
      "# HELP nearby_admission_in_flight Current admitted location requests by workload.",
      "# TYPE nearby_admission_in_flight gauge",
      `nearby_admission_in_flight${renderLabels({ workload: "nearby" })} ${admissionNearbyInFlight}`,
      `nearby_admission_in_flight${renderLabels({ workload: "upsert" })} ${admissionUpsertInFlight}`,
      "# HELP nearby_admission_adaptive_enabled Whether adaptive concurrency is enabled: 1=yes, 0=no.",
      "# TYPE nearby_admission_adaptive_enabled gauge",
      `nearby_admission_adaptive_enabled ${adaptiveAdmissionEnabled}`,
      "# HELP nearby_admission_effective_limit Current effective concurrency limit after adaptive control.",
      "# TYPE nearby_admission_effective_limit gauge",
      `nearby_admission_effective_limit${renderLabels({ workload: "nearby" })} ${admissionNearbyEffectiveLimit}`,
      `nearby_admission_effective_limit${renderLabels({ workload: "upsert" })} ${admissionUpsertEffectiveLimit}`,
      "# HELP nearby_admission_utilization_ratio In-flight requests divided by the current effective admission limit.",
      "# TYPE nearby_admission_utilization_ratio gauge",
      `nearby_admission_utilization_ratio${renderLabels({ workload: "nearby" })} ${nearbyUtilization}`,
      `nearby_admission_utilization_ratio${renderLabels({ workload: "upsert" })} ${upsertUtilization}`,
      "# HELP nearby_admission_db_latency_ewma_milliseconds Adaptive controller EWMA of DB operation latency.",
      "# TYPE nearby_admission_db_latency_ewma_milliseconds gauge",
      `nearby_admission_db_latency_ewma_milliseconds${renderLabels({ workload: "nearby" })} ${admissionNearbyLatencyEwmaMs}`,
      `nearby_admission_db_latency_ewma_milliseconds${renderLabels({ workload: "upsert" })} ${admissionUpsertLatencyEwmaMs}`,
      "# HELP nearby_admission_db_latency_target_milliseconds Configured adaptive DB latency target.",
      "# TYPE nearby_admission_db_latency_target_milliseconds gauge",
      `nearby_admission_db_latency_target_milliseconds${renderLabels({ workload: "nearby" })} ${admissionNearbyLatencyTargetMs}`,
      `nearby_admission_db_latency_target_milliseconds${renderLabels({ workload: "upsert" })} ${admissionUpsertLatencyTargetMs}`,
    );

    lines.push(
      "# HELP nearby_lifecycle_state Process lifecycle state: 0=starting, 1=ready, 2=draining, 3=stopped.",
      "# TYPE nearby_lifecycle_state gauge",
      `nearby_lifecycle_state ${lifecycleState}`,
      "# HELP nearby_lifecycle_active_requests Active non-probe HTTP requests tracked by the process lifecycle.",
      "# TYPE nearby_lifecycle_active_requests gauge",
      `nearby_lifecycle_active_requests ${lifecycleActiveRequests}`,
    );

    const activePoolConnections = Math.max(0, pool.totalCount - pool.idleCount);
    const poolUtilization =
      config.PG_POOL_MAX > 0 ? activePoolConnections / config.PG_POOL_MAX : 0;
    lines.push(
      "# HELP nearby_cleanup_deleted_total Total stale locations deleted.",
      "# TYPE nearby_cleanup_deleted_total counter",
      `nearby_cleanup_deleted_total ${cleanupDeletedTotal}`,
      "# HELP nearby_cleanup_batches_total Total cleanup batches executed.",
      "# TYPE nearby_cleanup_batches_total counter",
      `nearby_cleanup_batches_total ${cleanupBatchesTotal}`,
      "# HELP nearby_cleanup_duration_seconds Total cleanup run duration in seconds.",
      "# TYPE nearby_cleanup_duration_seconds summary",
      `nearby_cleanup_duration_seconds_sum ${cleanupDurationSecondsSum}`,
      `nearby_cleanup_duration_seconds_count ${cleanupDurationCount}`,
      "# HELP nearby_db_errors_total Total observed database errors.",
      "# TYPE nearby_db_errors_total counter",
      `nearby_db_errors_total ${dbErrorsTotal}`,
      "# HELP nearby_pg_pool_total_connections Current PostgreSQL pool connections.",
      "# TYPE nearby_pg_pool_total_connections gauge",
      `nearby_pg_pool_total_connections ${pool.totalCount}`,
      "# HELP nearby_pg_pool_idle_connections Current idle PostgreSQL pool connections.",
      "# TYPE nearby_pg_pool_idle_connections gauge",
      `nearby_pg_pool_idle_connections ${pool.idleCount}`,
      "# HELP nearby_pg_pool_waiting_requests Current PostgreSQL pool waiters.",
      "# TYPE nearby_pg_pool_waiting_requests gauge",
      `nearby_pg_pool_waiting_requests ${pool.waitingCount}`,
      "# HELP nearby_pg_pool_utilization_ratio Active PostgreSQL pool connections divided by configured pool max.",
      "# TYPE nearby_pg_pool_utilization_ratio gauge",
      `nearby_pg_pool_utilization_ratio ${poolUtilization}`,
    );

    return `${lines.join("\n")}\n`;
  },
};
