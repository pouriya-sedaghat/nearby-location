const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateBenchmarkRuns,
  evaluateCanary,
} = require("../scripts/lib/canary-gate");

const run = (overrides = {}) => {
  const result = {
  requests: 1000,
  successes: 995,
  failures: 5,
  rejectionCount: 2,
  requestsPerSecond: 100,
  latencyMs: { p50: 20, p95: 50, p99: 80 },
  statuses: { 200: 995, 503: 5 },
  rejections: { concurrency: 2 },
  ...overrides,
  };
  return { ...result, successfulLatencyMs: result.latencyMs, ...overrides };
};

test("aggregateBenchmarkRuns weights rates and sums status/rejection counts", () => {
  const aggregate = aggregateBenchmarkRuns([
    run(),
    run({ requests: 500, successes: 500, failures: 0, rejectionCount: 0, requestsPerSecond: 90, latencyMs: { p50: 18, p95: 40, p99: 70 }, statuses: { 200: 500 }, rejections: {} }),
  ]);
  assert.equal(aggregate.requests, 1500);
  assert.equal(aggregate.failures, 5);
  assert.equal(aggregate.errorRate, 0.003333);
  assert.equal(aggregate.statuses[200], 1495);
  assert.equal(aggregate.statuses[503], 5);
  assert.equal(aggregate.rejections.concurrency, 2);
  assert.equal(aggregate.latencyMs.p95, 45);
});

test("canary gates compare successful work even when rejection-heavy total RPS rises", () => {
  const stable = aggregateBenchmarkRuns([run({ requests: 1000, successes: 1000, failures: 0 })]);
  const candidate = aggregateBenchmarkRuns([run({
    requests: 3000, successes: 600, failures: 2400, requestsPerSecond: 300,
    latencyMs: { p50: 1, p95: 1, p99: 200 },
    successfulLatencyMs: { p50: 100, p95: 200, p99: 300 },
  })]);
  const gate = evaluateCanary(stable, candidate, { maxCandidateErrorRate: 1, maxErrorRateDelta: 1 });
  assert.equal(candidate.successfulRequestsPerSecond, 60);
  assert.equal(gate.comparisons.rpsRatio, 0.6);
  assert.equal(gate.comparisons.p95Ratio, 4);
  assert.equal(gate.passed, false);
  const legacy = run();
  delete legacy.successfulLatencyMs;
  const unavailable = aggregateBenchmarkRuns([run({ failures: 0 }), legacy]);
  assert.equal(unavailable.successfulLatencyMs.p95, null);
});

test("evaluateCanary passes a candidate inside relative and absolute budgets", () => {
  const stable = aggregateBenchmarkRuns([run()]);
  const candidate = aggregateBenchmarkRuns([
    run({ requestsPerSecond: 95, latencyMs: { p50: 21, p95: 55, p99: 90 } }),
  ]);
  const gate = evaluateCanary(stable, candidate);
  assert.equal(gate.passed, true);
  assert.deepEqual(gate.failures, []);
});

test("evaluateCanary fails latency, throughput, errors and controlled rejections", () => {
  const stable = aggregateBenchmarkRuns([run({ failures: 0, successes: 1000, rejectionCount: 0, statuses: { 200: 1000 }, rejections: {} })]);
  const candidate = aggregateBenchmarkRuns([
    run({
      failures: 40,
      successes: 960,
      rejectionCount: 30,
      requestsPerSecond: 60,
      latencyMs: { p50: 40, p95: 100, p99: 150 },
      statuses: { 200: 960, 503: 40 },
      rejections: { pool_queue: 30 },
    }),
  ]);
  const gate = evaluateCanary(stable, candidate);
  assert.equal(gate.passed, false);
  assert.ok(gate.failures.length >= 5);
});

test("evaluateCanary fails when latency comparison is unavailable", () => {
  const stable = aggregateBenchmarkRuns([run({ latencyMs: { p50: null, p95: null, p99: null } })]);
  const candidate = aggregateBenchmarkRuns([run({ latencyMs: { p50: null, p95: null, p99: null } })]);
  const gate = evaluateCanary(stable, candidate);
  assert.equal(gate.passed, false);
  assert.ok(gate.failures.some((failure) => failure.includes("p95 comparison")));
});
