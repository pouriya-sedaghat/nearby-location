const percentile = (sorted, p) => {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
};

const round = (value, digits = 3) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

const summarizeDurations = (durations) => {
  if (!Array.isArray(durations) || durations.length === 0) {
    return {
      min: null,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    min: round(sorted[0]),
    mean: round(sum / sorted.length),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
  };
};

// Older reports can recover useful throughput from counts, but mixed latency
// percentiles cannot be separated after collection. Never substitute them for
// successful-request latency when failures were present.
const successfulMetrics = (summary) => {
  const requests = summary.requests;
  const successes = summary.successes ?? (requests - summary.failures);
  return {
    requestsPerSecond: Object.hasOwn(summary, "successfulRequestsPerSecond")
      ? summary.successfulRequestsPerSecond
      : requests > 0 && Number.isFinite(successes) && Number.isFinite(summary.requestsPerSecond)
        ? summary.requestsPerSecond * successes / requests
        : null,
    latencyMs: Object.hasOwn(summary, "successfulLatencyMs")
      ? summary.successfulLatencyMs
      : summary.failures === 0 ? summary.latencyMs : null,
  };
};

const evaluateBudget = (summary, budget = {}) => {
  const failures = [];
  const successful = successfulMetrics(summary);
  const errorRate = summary.requests > 0 ? summary.failures / summary.requests : 1;
  if (summary.requests <= 0) failures.push("no requests were measured");

  if (
    budget.maxErrorRate !== undefined &&
    errorRate > budget.maxErrorRate
  ) {
    failures.push(
      `error rate ${(errorRate * 100).toFixed(2)}% exceeded ${(budget.maxErrorRate * 100).toFixed(2)}%`,
    );
  }
  for (const [percentile, maximum] of [["p95", budget.maxP95Ms], ["p99", budget.maxP99Ms]]) {
    if (maximum === undefined) continue;
    const value = successful.latencyMs?.[percentile];
    if (!Number.isFinite(value)) failures.push(`${percentile} latency is unavailable`);
    else if (value > maximum) failures.push(`${percentile} ${value}ms exceeded ${maximum}ms`);
  }
  if (budget.minRequestsPerSecond !== undefined) {
    if (!Number.isFinite(successful.requestsPerSecond)) {
      failures.push("successful throughput is unavailable");
    } else if (successful.requestsPerSecond < budget.minRequestsPerSecond) {
      failures.push(
        `successful throughput ${successful.requestsPerSecond} rps was below ${budget.minRequestsPerSecond} rps`,
      );
    }
  }

  return {
    passed: failures.length === 0,
    metricBasis: "successful_requests",
    failures,
    maxErrorRate: budget.maxErrorRate ?? null,
    maxP95Ms: budget.maxP95Ms ?? null,
    maxP99Ms: budget.maxP99Ms ?? null,
    minRequestsPerSecond: budget.minRequestsPerSecond ?? null,
  };
};

module.exports = {
  percentile,
  summarizeDurations,
  successfulMetrics,
  evaluateBudget,
};
