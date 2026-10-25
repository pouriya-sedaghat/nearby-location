const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  aggregateBenchmarkRuns,
  evaluateCanary,
} = require("./lib/canary-gate");

const readNumber = (name, fallback, min, max) => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

const normalizeUrl = (name) => {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required`);
  return raw.replace(/\/$/, "");
};

const stableUrl = normalizeUrl("CANARY_STABLE_BASE_URL");
const candidateUrl = normalizeUrl("CANARY_CANDIDATE_BASE_URL");
if (stableUrl === candidateUrl) {
  throw new Error("stable and candidate URLs must be different");
}

const rounds = Math.trunc(readNumber("CANARY_ROUNDS", 3, 1, 20));
const thresholds = {
  maxCandidateErrorRate: readNumber("CANARY_MAX_ERROR_RATE", 0.01, 0, 1),
  maxErrorRateDelta: readNumber("CANARY_MAX_ERROR_RATE_DELTA", 0.005, 0, 1),
  maxCandidateRejectionRate: readNumber(
    "CANARY_MAX_REJECTION_RATE",
    0.02,
    0,
    1,
  ),
  maxRejectionRateDelta: readNumber(
    "CANARY_MAX_REJECTION_RATE_DELTA",
    0.01,
    0,
    1,
  ),
  maxP95Ratio: readNumber("CANARY_MAX_P95_RATIO", 1.25, 1, 100),
  maxP99Ratio: readNumber("CANARY_MAX_P99_RATIO", 1.35, 1, 100),
  minRpsRatio: readNumber("CANARY_MIN_RPS_RATIO", 0.8, 0, 100),
};

const benchmarkScript = path.resolve(__dirname, "benchmark-http.js");
const cleanBenchmarkEnv = (baseUrl) => {
  const env = {
    ...process.env,
    BENCHMARK_BASE_URL: baseUrl,
    // Canary comparison owns the relative gate. Avoid child absolute-budget exits.
    BENCHMARK_MAX_ERROR_RATE: "1",
  };
  delete env.BENCHMARK_MAX_P95_MS;
  delete env.BENCHMARK_MAX_P99_MS;
  delete env.BENCHMARK_MIN_RPS;
  return env;
};

const runBenchmark = (name, baseUrl, roundIndex) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [benchmarkScript], {
      env: cleanBenchmarkEnv(baseUrl),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (error) {
        reject(
          new Error(
            `${name} round ${roundIndex + 1} returned invalid JSON: ${stderr || error.message}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `${name} round ${roundIndex + 1} benchmark exited ${code}: ${stderr || stdout}`,
          ),
        );
        return;
      }
      resolve(parsed);
    });
  });

(async () => {
  const stableRuns = [];
  const candidateRuns = [];

  for (let i = 0; i < rounds; i += 1) {
    // Alternate order to reduce systematic bias from cache/background load drift.
    const order =
      i % 2 === 0
        ? [
            ["stable", stableUrl, stableRuns],
            ["candidate", candidateUrl, candidateRuns],
          ]
        : [
            ["candidate", candidateUrl, candidateRuns],
            ["stable", stableUrl, stableRuns],
          ];

    for (const [name, url, target] of order) {
      const result = await runBenchmark(name, url, i);
      target.push(result);
    }
  }

  const stable = aggregateBenchmarkRuns(stableRuns);
  const candidate = aggregateBenchmarkRuns(candidateRuns);
  const gate = evaluateCanary(stable, candidate, thresholds);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    workload: {
      requestMode: process.env.BENCHMARK_REQUEST_MODE ?? "offset_first",
      rounds,
      stableUrl,
      candidateUrl,
    },
    stable,
    candidate,
    gate,
    raw: process.env.CANARY_INCLUDE_RAW_RUNS === "true"
      ? { stable: stableRuns, candidate: candidateRuns }
      : undefined,
  };

  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (process.env.CANARY_OUTPUT_FILE) {
    const outputPath = path.resolve(process.env.CANARY_OUTPUT_FILE);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${output}\n`);
  }
  if (!gate.passed) process.exitCode = 2;
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
