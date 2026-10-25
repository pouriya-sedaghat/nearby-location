const { successfulMetrics } = require("./benchmark-stats");

const median = (values) => {
  const filtered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return filtered[middle];
  return (filtered[middle - 1] + filtered[middle]) / 2;
};

const round = (value, digits = 6) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

const numericMetric = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : NaN;

const sumMaps = (runs, field) => {
  const totals = {};
  for (const run of runs) {
    for (const [key, value] of Object.entries(run[field] ?? {})) {
      totals[key] = (totals[key] ?? 0) + Number(value || 0);
    }
  }
  return totals;
};

const aggregateBenchmarkRuns = (runs) => {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error("at least one benchmark run is required");
  }

  const requests = runs.reduce((total, run) => total + Number(run.requests || 0), 0);
  const successes = runs.reduce((total, run) => total + Number(run.successes || 0), 0);
  const failures = runs.reduce((total, run) => total + Number(run.failures || 0), 0);
  const rejectionCount = runs.reduce(
    (total, run) => total + Number(run.rejectionCount || 0),
    0,
  );
  const successful = runs.map(successfulMetrics);

  return {
    rounds: runs.length,
    requests,
    successes,
    failures,
    errorRate: round(requests > 0 ? failures / requests : 1),
    rejectionCount,
    rejectionRate: round(requests > 0 ? rejectionCount / requests : 0),
    requestsPerSecond: round(
      runs.reduce((total, run) => total + Number(run.requestsPerSecond || 0), 0) /
        runs.length,
      2,
    ),
    latencyMs: {
      p50: round(median(runs.map((run) => numericMetric(run.latencyMs?.p50))), 3),
      p95: round(median(runs.map((run) => numericMetric(run.latencyMs?.p95))), 3),
      p99: round(median(runs.map((run) => numericMetric(run.latencyMs?.p99))), 3),
    },
    successfulRequestsPerSecond: successful.every((item) => Number.isFinite(item.requestsPerSecond))
      ? round(successful.reduce((total, item) => total + item.requestsPerSecond, 0) / runs.length, 2)
      : null,
    successfulLatencyMs: Object.fromEntries(["p50", "p95", "p99"].map((key) => [
      key,
      successful.every((item) => Number.isFinite(item.latencyMs?.[key]))
        ? round(median(successful.map((item) => item.latencyMs[key])), 3)
        : null,
    ])),
    statuses: sumMaps(runs, "statuses"),
    rejections: sumMaps(runs, "rejections"),
    aggregation: "rates weighted by request count; throughput averaged; latency percentiles are median of per-round percentiles",
  };
};

const ratio = (candidate, stable) => {
  if (!Number.isFinite(candidate) || !Number.isFinite(stable)) return null;
  if (stable <= 0) return candidate <= 0 ? 1 : Infinity;
  return candidate / stable;
};

const evaluateCanary = (stable, candidate, thresholds = {}) => {
  const stableSuccessful = successfulMetrics(stable);
  const candidateSuccessful = successfulMetrics(candidate);
  const settings = {
    maxCandidateErrorRate: thresholds.maxCandidateErrorRate ?? 0.01,
    maxErrorRateDelta: thresholds.maxErrorRateDelta ?? 0.005,
    maxCandidateRejectionRate: thresholds.maxCandidateRejectionRate ?? 0.02,
    maxRejectionRateDelta: thresholds.maxRejectionRateDelta ?? 0.01,
    maxP95Ratio: thresholds.maxP95Ratio ?? 1.25,
    maxP99Ratio: thresholds.maxP99Ratio ?? 1.35,
    minRpsRatio: thresholds.minRpsRatio ?? 0.8,
  };

  const comparisons = {
    errorRateDelta: round(candidate.errorRate - stable.errorRate),
    rejectionRateDelta: round(candidate.rejectionRate - stable.rejectionRate),
    p95Ratio: round(ratio(candidateSuccessful.latencyMs?.p95, stableSuccessful.latencyMs?.p95)),
    p99Ratio: round(ratio(candidateSuccessful.latencyMs?.p99, stableSuccessful.latencyMs?.p99)),
    rpsRatio: round(ratio(candidateSuccessful.requestsPerSecond, stableSuccessful.requestsPerSecond)),
  };

  const failures = [];
  if (candidate.errorRate > settings.maxCandidateErrorRate) {
    failures.push(
      `candidate error rate ${(candidate.errorRate * 100).toFixed(2)}% exceeded ${(settings.maxCandidateErrorRate * 100).toFixed(2)}%`,
    );
  }
  if (comparisons.errorRateDelta > settings.maxErrorRateDelta) {
    failures.push(
      `candidate error-rate delta ${(comparisons.errorRateDelta * 100).toFixed(2)}pp exceeded ${(settings.maxErrorRateDelta * 100).toFixed(2)}pp`,
    );
  }
  if (candidate.rejectionRate > settings.maxCandidateRejectionRate) {
    failures.push(
      `candidate controlled-rejection rate ${(candidate.rejectionRate * 100).toFixed(2)}% exceeded ${(settings.maxCandidateRejectionRate * 100).toFixed(2)}%`,
    );
  }
  if (comparisons.rejectionRateDelta > settings.maxRejectionRateDelta) {
    failures.push(
      `candidate rejection-rate delta ${(comparisons.rejectionRateDelta * 100).toFixed(2)}pp exceeded ${(settings.maxRejectionRateDelta * 100).toFixed(2)}pp`,
    );
  }
  if (comparisons.p95Ratio === null || comparisons.p95Ratio > settings.maxP95Ratio) {
    failures.push(
      comparisons.p95Ratio === null
        ? "p95 comparison is unavailable"
        : `candidate p95 ratio ${comparisons.p95Ratio.toFixed(3)} exceeded ${settings.maxP95Ratio}`,
    );
  }
  if (comparisons.p99Ratio === null || comparisons.p99Ratio > settings.maxP99Ratio) {
    failures.push(
      comparisons.p99Ratio === null
        ? "p99 comparison is unavailable"
        : `candidate p99 ratio ${comparisons.p99Ratio.toFixed(3)} exceeded ${settings.maxP99Ratio}`,
    );
  }
  if (comparisons.rpsRatio === null || comparisons.rpsRatio < settings.minRpsRatio) {
    failures.push(
      comparisons.rpsRatio === null
        ? "throughput comparison is unavailable"
        : `candidate throughput ratio ${comparisons.rpsRatio.toFixed(3)} was below ${settings.minRpsRatio}`,
    );
  }

  return {
    passed: failures.length === 0,
    metricBasis: "successful_requests",
    failures,
    thresholds: settings,
    comparisons,
  };
};

module.exports = {
  median,
  aggregateBenchmarkRuns,
  evaluateCanary,
};
