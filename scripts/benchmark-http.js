const { performance } = require("node:perf_hooks");
const {
  summarizeDurations,
  evaluateBudget,
} = require("./lib/benchmark-stats");

const readNumber = (name, fallback, min, max, optional = false) => {
  const raw = process.env[name];
  if (optional && (raw === undefined || raw === "")) return undefined;
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

const validModes = new Set([
  "offset_first",
  "offset_deep",
  "cursor_first",
  "cursor_next",
]);

const legacyPagination = process.env.BENCHMARK_PAGINATION;
const requestedMode =
  process.env.BENCHMARK_REQUEST_MODE ??
  (legacyPagination === "cursor" ? "cursor_first" : "offset_first");
if (!validModes.has(requestedMode)) {
  throw new Error(
    `BENCHMARK_REQUEST_MODE must be one of ${[...validModes].join(", ")}`,
  );
}

const baseUrl = (process.env.BENCHMARK_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const durationSeconds = readNumber("BENCHMARK_DURATION_SECONDS", 15, 1, 3600);
const warmupSeconds = readNumber("BENCHMARK_WARMUP_SECONDS", 2, 0, 300);
const concurrency = Math.trunc(readNumber("BENCHMARK_CONCURRENCY", 20, 1, 2000));
const timeoutMs = Math.trunc(readNumber("BENCHMARK_REQUEST_TIMEOUT_MS", 5000, 100, 120000));
const lat = readNumber("BENCHMARK_LAT", 35.6892, -90, 90);
const lng = readNumber("BENCHMARK_LNG", 51.389, -180, 180);
const maxDistance = readNumber("BENCHMARK_MAX_DISTANCE_METERS", 10000, 1, 20000000);
const pageSize = Math.trunc(readNumber("BENCHMARK_PAGE_SIZE", 20, 1, 100));
const deepPage = Math.trunc(readNumber("BENCHMARK_PAGE", 1000, 2, 10000000));
const excludeUserId = process.env.BENCHMARK_EXCLUDE_USER_ID || undefined;

const budget = {
  maxErrorRate: readNumber("BENCHMARK_MAX_ERROR_RATE", 0, 0, 1),
  maxP95Ms: readNumber("BENCHMARK_MAX_P95_MS", undefined, 0.001, 120000, true),
  maxP99Ms: readNumber("BENCHMARK_MAX_P99_MS", undefined, 0.001, 120000, true),
  minRequestsPerSecond: readNumber("BENCHMARK_MIN_RPS", undefined, 0.001, 1000000, true),
};

const endpoint = `${baseUrl}/location/nearby`;

const authToken = process.env.BENCHMARK_AUTH_TOKEN || undefined;


const basePayload = () => ({
  coordinate: { lat, lng },
  maxDistance,
  pageSize,
  ...(excludeUserId ? { excludeUserId } : {}),
});

const payloadForMode = (mode, cursor) => {
  const payload = basePayload();
  if (mode === "offset_first") return { ...payload, pagination: "offset", page: 1 };
  if (mode === "offset_deep") return { ...payload, pagination: "offset", page: deepPage };
  if (mode === "cursor_first") return { ...payload, pagination: "cursor" };
  if (mode === "cursor_next") {
    if (!cursor) throw new Error("cursor_next requires a bootstrap cursor");
    return { ...payload, pagination: "cursor", cursor };
  }
  throw new Error(`Unsupported benchmark mode: ${mode}`);
};

const fetchJson = async (payload, captureBody = false) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body;
    if (captureBody) {
      body = await response.json().catch(() => null);
    } else {
      await response.arrayBuffer();
    }
    return {
      ok: response.ok,
      status: response.status,
      rejectionReason: response.headers.get("x-nearby-rejection-reason") || null,
      body,
      durationMs: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: "network_error",
      error,
      durationMs: performance.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const bootstrapCursor = async () => {
  if (requestedMode !== "cursor_next") return undefined;
  const response = await fetchJson(
    { ...basePayload(), pagination: "cursor" },
    true,
  );
  if (!response.ok) {
    throw new Error(
      `cursor bootstrap failed with status ${response.status}`,
    );
  }
  const cursor = response.body?.nextCursor;
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new Error(
      "cursor bootstrap did not return nextCursor; increase benchmark radius/dataset density",
    );
  }
  return {
    value: cursor,
    signed: cursor.startsWith("s1."),
  };
};

const runPhase = async ({ seconds, cursor, collect }) => {
  if (seconds <= 0) return { requests: 0 };
  const deadline = performance.now() + seconds * 1000;
  const durations = [];
  const successfulDurations = [];
  const failedDurations = [];
  const statuses = new Map();
  const rejections = new Map();
  let successes = 0;
  let failures = 0;

  const worker = async () => {
    while (performance.now() < deadline) {
      const response = await fetchJson(payloadForMode(requestedMode, cursor));
      if (collect) {
        durations.push(response.durationMs);
        statuses.set(
          response.status,
          (statuses.get(response.status) ?? 0) + 1,
        );
        if (response.rejectionReason) {
          rejections.set(
            response.rejectionReason,
            (rejections.get(response.rejectionReason) ?? 0) + 1,
          );
        }
        if (response.ok) {
          successes += 1;
          successfulDurations.push(response.durationMs);
        } else {
          failures += 1;
          failedDurations.push(response.durationMs);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    requests: durations.length,
    successes,
    failures,
    durations,
    successfulDurations,
    failedDurations,
    statuses,
    rejections,
  };
};

(async () => {
  const bootstrap = await bootstrapCursor();
  const cursor = bootstrap?.value;

  if (warmupSeconds > 0) {
    await runPhase({ seconds: warmupSeconds, cursor, collect: false });
  }

  const measuredStarted = performance.now();
  const measured = await runPhase({
    seconds: durationSeconds,
    cursor,
    collect: true,
  });
  const elapsedSeconds = (performance.now() - measuredStarted) / 1000;
  const requests = measured.requests;
  const requestsPerSecond =
    elapsedSeconds > 0 ? requests / elapsedSeconds : 0;
  const errorRate = requests > 0 ? measured.failures / requests : 1;
  const rejectionCount = [...measured.rejections.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const rejectionRate = requests > 0 ? rejectionCount / requests : 0;

  const summary = {
    target: endpoint,
    requestMode: requestedMode,
    config: {
      concurrency,
      warmupSeconds,
      durationSeconds,
      timeoutMs,
      lat,
      lng,
      maxDistance,
      pageSize,
      ...(requestedMode === "offset_deep" ? { page: deepPage } : {}),
      ...(requestedMode === "cursor_next"
        ? { cursorBootstrapSigned: bootstrap?.signed ?? false }
        : {}),
    },
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    requests,
    successes: measured.successes,
    failures: measured.failures,
    errorRate: Number(errorRate.toFixed(6)),
    rejectionCount,
    rejectionRate: Number(rejectionRate.toFixed(6)),
    requestsPerSecond: Number(requestsPerSecond.toFixed(2)),
    successfulRequestsPerSecond: Number((measured.successes / elapsedSeconds).toFixed(2)),
    latencyMs: summarizeDurations(measured.durations),
    successfulLatencyMs: summarizeDurations(measured.successfulDurations),
    failedLatencyMs: summarizeDurations(measured.failedDurations),
    statuses: Object.fromEntries(measured.statuses),
    rejections: Object.fromEntries(measured.rejections),
  };
  summary.budget = evaluateBudget(summary, budget);

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.budget.passed) process.exitCode = 2;
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
