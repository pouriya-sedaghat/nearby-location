const test = require("node:test");
const assert = require("node:assert/strict");
const {
  summarizeDurations,
  evaluateBudget,
  successfulMetrics,
} = require("../scripts/lib/benchmark-stats");
const {
  parseCsv,
  renderMatrixMarkdown,
} = require("../scripts/lib/benchmark-matrix");
const { calculateConnectionCapacity } = require("../scripts/lib/capacity");

test("duration summary calculates stable percentiles", () => {
  const summary = summarizeDurations([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(summary.min, 10);
  assert.equal(summary.mean, 55);
  assert.equal(summary.p50, 50);
  assert.equal(summary.p95, 100);
  assert.equal(summary.p99, 100);
  assert.equal(summary.max, 100);
});

test("budget reports latency, error-rate and throughput regressions", () => {
  const result = evaluateBudget(
    {
      requests: 100,
      failures: 2,
      requestsPerSecond: 50,
      latencyMs: { p95: 120, p99: 180 },
      successfulLatencyMs: { p95: 120, p99: 180 },
    },
    {
      maxErrorRate: 0.01,
      maxP95Ms: 100,
      maxP99Ms: 200,
      minRequestsPerSecond: 60,
    },
  );
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 3);
});

test("connection capacity accounts for replicas, reserved slots and headroom", () => {
  const summary = calculateConnectionCapacity({
    maxConnections: 200,
    superuserReservedConnections: 3,
    reservedConnections: 2,
    expectedReplicas: 8,
    poolMax: 10,
    externalReserve: 20,
    maxUtilizationPercent: 70,
  });
  assert.equal(summary.usableConnections, 195);
  assert.equal(summary.serviceConnectionBudget, 116);
  assert.equal(summary.configuredServiceConnections, 80);
  assert.equal(summary.maxSafeReplicas, 11);
  assert.equal(summary.headroom, 36);
  assert.equal(summary.passed, true);
});

test("benchmark budgets fail when requests or required latency samples are unavailable", () => {
  const summary = { requests: 0, failures: 0, requestsPerSecond: 0, latencyMs: { p95: null, p99: null } };
  assert.equal(evaluateBudget(summary).passed, false);
  const result = evaluateBudget({ ...summary, requests: 1 }, { maxP95Ms: 100, maxP99Ms: 200 });
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 2);
});

test("connection capacity fails an overcommitted deployment", () => {
  const summary = calculateConnectionCapacity({
    maxConnections: 100,
    superuserReservedConnections: 3,
    expectedReplicas: 10,
    poolMax: 10,
    externalReserve: 10,
    maxUtilizationPercent: 80,
  });
  assert.equal(summary.passed, false);
  assert.ok(summary.headroom < 0);
});

test("matrix helpers parse CSV and render a concise markdown table", () => {
  assert.deepEqual(parseCsv("a, b,,c"), ["a", "b", "c"]);
  const markdown = renderMatrixMarkdown({
    generatedAt: "2026-10-07T00:00:00.000Z",
    passed: true,
    results: [
      {
        datasetLabel: "100000",
        radiusMeters: 10000,
        concurrency: 10,
        mode: "cursor_next",
        passed: true,
        result: {
          requests: 500,
          failures: 0,
          requestsPerSecond: 500,
          errorRate: 0,
          latencyMs: { p95: 20, p99: 30 },
        },
      },
    ],
    plans: [],
    failures: [],
  });
  assert.match(markdown, /cursor_next/);
  assert.match(markdown, /500/);
  assert.match(markdown, /PASS/);
});

test("fast rejected requests cannot satisfy successful latency or throughput budgets", () => {
  const summary = {
    requests: 100, successes: 5, failures: 95, requestsPerSecond: 1000,
    successfulRequestsPerSecond: 50,
    latencyMs: { p95: 1, p99: 300 },
    successfulLatencyMs: { p95: 300, p99: 400 },
  };
  const result = evaluateBudget(summary, { maxErrorRate: 1, maxP95Ms: 100, minRequestsPerSecond: 100 });
  assert.equal(result.passed, false);
  assert.equal(result.metricBasis, "successful_requests");
  assert.equal(result.failures.length, 2);
  const legacy = { ...summary };
  delete legacy.successfulRequestsPerSecond;
  delete legacy.successfulLatencyMs;
  assert.equal(successfulMetrics(legacy).requestsPerSecond, 50);
  assert.equal(successfulMetrics(legacy).latencyMs, null);
  assert.equal(evaluateBudget(legacy, { maxP95Ms: 100 }).passed, false);
});

test("HTTP benchmark separates delayed successes from immediate capacity rejections", async () => {
  const http = require("node:http");
  const { spawn } = require("node:child_process");
  const path = require("node:path");
  let count = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    if (++count % 10 < 7) {
      response.writeHead(503, { "X-Nearby-Rejection-Reason": "pool_queue" });
      response.end("{}");
    } else {
      setTimeout(() => { response.writeHead(200); response.end("{}"); }, 25);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const child = spawn(process.execPath, ["scripts/benchmark-http.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, BENCHMARK_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        BENCHMARK_DURATION_SECONDS: "1", BENCHMARK_WARMUP_SECONDS: "0", BENCHMARK_CONCURRENCY: "1",
        BENCHMARK_REQUEST_MODE: "cursor_first", BENCHMARK_MAX_ERROR_RATE: "1",
        BENCHMARK_MAX_P95_MS: "5", BENCHMARK_MAX_P99_MS: "", BENCHMARK_MIN_RPS: "" },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    assert.equal(code, 2, stderr);
    const report = JSON.parse(stdout);
    assert.ok(report.successes > 0 && report.failures > report.successes);
    assert.equal(report.rejections.pool_queue, report.failures);
    assert.ok(report.successfulRequestsPerSecond < report.requestsPerSecond);
    assert.ok(report.successfulLatencyMs.p50 > report.failedLatencyMs.p50);
    assert.ok(report.budget.failures.some((failure) => failure.includes("p95")));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
