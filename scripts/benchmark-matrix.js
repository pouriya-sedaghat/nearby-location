const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  parseCsv,
  renderMatrixMarkdown,
} = require("./lib/benchmark-matrix");

const readNumber = (name, fallback, min, max) => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

const readBool = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
};

const parsePositiveIntList = (name, fallback) => {
  const values = parseCsv(process.env[name] ?? fallback, Number);
  if (
    values.length === 0 ||
    values.some((value) => !Number.isInteger(value) || value <= 0)
  ) {
    throw new Error(`${name} must be a comma-separated list of positive integers`);
  }
  return values;
};

const validModes = new Set([
  "offset_first",
  "offset_deep",
  "cursor_first",
  "cursor_next",
]);
const modes = parseCsv(
  process.env.BENCHMARK_MATRIX_MODES ??
    "cursor_first,cursor_next,offset_first,offset_deep",
);
if (modes.length === 0 || modes.some((mode) => !validModes.has(mode))) {
  throw new Error(
    `BENCHMARK_MATRIX_MODES must use ${[...validModes].join(", ")}`,
  );
}

const radii = parsePositiveIntList(
  "BENCHMARK_MATRIX_RADII_METERS",
  "1000,10000,50000",
);
const concurrencies = parsePositiveIntList(
  "BENCHMARK_MATRIX_CONCURRENCIES",
  "1,10,50",
);
const datasetSizes = parseCsv(
  process.env.BENCHMARK_MATRIX_DATASET_SIZES ?? "",
  Number,
);
if (
  datasetSizes.some(
    (value) => !Number.isInteger(value) || value <= 0 || value > 20_000_000,
  )
) {
  throw new Error(
    "BENCHMARK_MATRIX_DATASET_SIZES must contain integers from 1 to 20000000",
  );
}
for (let i = 1; i < datasetSizes.length; i += 1) {
  if (datasetSizes[i] <= datasetSizes[i - 1]) {
    throw new Error(
      "BENCHMARK_MATRIX_DATASET_SIZES must be strictly increasing",
    );
  }
}

const seed = readBool("BENCHMARK_MATRIX_SEED", false);
if (datasetSizes.length > 0 && !seed) {
  throw new Error(
    "BENCHMARK_MATRIX_DATASET_SIZES requires BENCHMARK_MATRIX_SEED=true; omit dataset sizes to benchmark the current database",
  );
}
if (seed && datasetSizes.length === 0) {
  throw new Error(
    "BENCHMARK_MATRIX_SEED=true requires BENCHMARK_MATRIX_DATASET_SIZES",
  );
}

const truncateFirst = readBool("BENCHMARK_MATRIX_TRUNCATE", false);
if (
  truncateFirst &&
  process.env.BENCHMARK_MATRIX_CONFIRM !== "TRUNCATE_LOCATIONS"
) {
  throw new Error(
    "BENCHMARK_MATRIX_TRUNCATE=true requires BENCHMARK_MATRIX_CONFIRM=TRUNCATE_LOCATIONS",
  );
}

const runExplain = readBool("BENCHMARK_MATRIX_RUN_EXPLAIN", false);
const inspectDb = readBool("BENCHMARK_MATRIX_INSPECT_DB", false);
const failFast = readBool("BENCHMARK_MATRIX_FAIL_FAST", false);
const durationSeconds = readNumber(
  "BENCHMARK_MATRIX_DURATION_SECONDS",
  10,
  1,
  3600,
);
const warmupSeconds = readNumber(
  "BENCHMARK_MATRIX_WARMUP_SECONDS",
  2,
  0,
  300,
);

const outputDir = path.resolve(
  process.env.BENCHMARK_MATRIX_OUTPUT_DIR ?? "benchmark-results",
);
const outputName =
  process.env.BENCHMARK_MATRIX_OUTPUT_NAME ??
  `matrix-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const jsonPath = path.join(outputDir, `${outputName}.json`);
const markdownPath = path.join(outputDir, `${outputName}.md`);

const scriptPath = (name) => path.resolve(__dirname, name);

const runJsonScript = (script, env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath(script)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, error: error.message, stderr, stdout });
    });
    child.on("close", (exitCode) => {
      let result;
      let parseError;
      try {
        result = JSON.parse(stdout.trim());
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
      resolve({
        exitCode: exitCode ?? 1,
        result,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        parseError,
      });
    });
  });

const benchmarkBudgetEnv = () => ({
  ...(process.env.BENCHMARK_MATRIX_MAX_ERROR_RATE !== undefined
    ? { BENCHMARK_MAX_ERROR_RATE: process.env.BENCHMARK_MATRIX_MAX_ERROR_RATE }
    : {}),
  ...(process.env.BENCHMARK_MATRIX_MAX_P95_MS !== undefined
    ? { BENCHMARK_MAX_P95_MS: process.env.BENCHMARK_MATRIX_MAX_P95_MS }
    : {}),
  ...(process.env.BENCHMARK_MATRIX_MAX_P99_MS !== undefined
    ? { BENCHMARK_MAX_P99_MS: process.env.BENCHMARK_MATRIX_MAX_P99_MS }
    : {}),
  ...(process.env.BENCHMARK_MATRIX_MIN_RPS !== undefined
    ? { BENCHMARK_MIN_RPS: process.env.BENCHMARK_MATRIX_MIN_RPS }
    : {}),
});

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    passed: true,
    config: {
      baseUrl: process.env.BENCHMARK_BASE_URL ?? "http://127.0.0.1:8080",
      datasetSizes: datasetSizes.length > 0 ? datasetSizes : ["current"],
      radiiMeters: radii,
      concurrencies,
      modes,
      durationSeconds,
      warmupSeconds,
      runExplain,
      inspectDb,
    },
    datasets: [],
    plans: [],
    results: [],
    failures: [],
  };

  const datasets = datasetSizes.length > 0 ? datasetSizes : [null];

  for (let datasetIndex = 0; datasetIndex < datasets.length; datasetIndex += 1) {
    const targetSize = datasets[datasetIndex];
    let datasetLabel = targetSize === null ? "current" : String(targetSize);
    let seedResult;

    if (targetSize !== null) {
      const seedRun = await runJsonScript("seed-benchmark.js", {
        BENCHMARK_SEED_COUNT: String(targetSize),
        BENCHMARK_SEED_TRUNCATE:
          truncateFirst && datasetIndex === 0 ? "true" : "false",
        ...(truncateFirst && datasetIndex === 0
          ? { BENCHMARK_SEED_CONFIRM: "TRUNCATE_LOCATIONS" }
          : {}),
      });
      seedResult = seedRun.result;
      if (seedRun.exitCode !== 0 || !seedResult) {
        const failure = `seed failed for target ${targetSize}: ${seedRun.stderr || seedRun.parseError || seedRun.stdout}`;
        report.failures.push(failure);
        report.passed = false;
        if (failFast) break;
        continue;
      }
      datasetLabel = String(seedResult.totalRows ?? targetSize);
      if (Number(seedResult.seededRows) !== targetSize) {
        const failure =
          `dataset target ${targetSize} is not exact: prefix contains ${seedResult.seededRows} rows; ` +
          "use a disposable/clean database or BENCHMARK_MATRIX_TRUNCATE=true";
        report.failures.push(failure);
        report.passed = false;
        if (failFast) break;
      }
    }

    let inspection;
    if (inspectDb) {
      const inspectionRun = await runJsonScript("inspect-db.js", {});
      inspection = inspectionRun.result;
      if (inspectionRun.exitCode !== 0 || !inspection) {
        report.failures.push(
          `database inspection failed for ${datasetLabel}: ${inspectionRun.stderr || inspectionRun.parseError || inspectionRun.stdout}`,
        );
        report.passed = false;
        if (failFast) break;
      }
    }

    report.datasets.push({
      datasetLabel,
      targetSize,
      seed: seedResult ?? null,
      inspection: inspection ?? null,
    });

    if (runExplain) {
      for (const radiusMeters of radii) {
        const planRun = await runJsonScript("explain-nearby.js", {
          EXPLAIN_OUTPUT: "json",
          EXPLAIN_MAX_DISTANCE_METERS: String(radiusMeters),
          ...(process.env.BENCHMARK_MATRIX_REQUIRE_GIST_INDEX !== undefined
            ? {
                EXPLAIN_REQUIRE_GIST_INDEX:
                  process.env.BENCHMARK_MATRIX_REQUIRE_GIST_INDEX,
              }
            : {}),
          ...(process.env.BENCHMARK_MATRIX_MAX_EXPLAIN_MS !== undefined
            ? {
                EXPLAIN_MAX_EXECUTION_MS:
                  process.env.BENCHMARK_MATRIX_MAX_EXPLAIN_MS,
              }
            : {}),
        });
        const passed = planRun.exitCode === 0 && Boolean(planRun.result);
        report.plans.push({
          datasetLabel,
          radiusMeters,
          passed,
          result: planRun.result ?? null,
          error: passed
            ? null
            : planRun.stderr || planRun.parseError || planRun.stdout,
        });
        if (!passed) {
          report.passed = false;
          report.failures.push(
            `EXPLAIN failed for dataset=${datasetLabel}, radius=${radiusMeters}`,
          );
          if (failFast) break;
        }
      }
      if (failFast && !report.passed) break;
    }

    for (const radiusMeters of radii) {
      for (const concurrency of concurrencies) {
        for (const mode of modes) {
          process.stderr.write(
            `Benchmark dataset=${datasetLabel} radius=${radiusMeters} concurrency=${concurrency} mode=${mode}\n`,
          );
          const run = await runJsonScript("benchmark-http.js", {
            BENCHMARK_REQUEST_MODE: mode,
            BENCHMARK_MAX_DISTANCE_METERS: String(radiusMeters),
            BENCHMARK_CONCURRENCY: String(concurrency),
            BENCHMARK_DURATION_SECONDS: String(durationSeconds),
            BENCHMARK_WARMUP_SECONDS: String(warmupSeconds),
            ...benchmarkBudgetEnv(),
          });
          const passed = run.exitCode === 0 && run.result?.budget?.passed === true;
          report.results.push({
            datasetLabel,
            radiusMeters,
            concurrency,
            mode,
            passed,
            result: run.result ?? null,
            error: passed ? null : run.stderr || run.parseError || run.stdout,
          });
          if (!passed) {
            report.passed = false;
            report.failures.push(
              `benchmark failed for dataset=${datasetLabel}, radius=${radiusMeters}, concurrency=${concurrency}, mode=${mode}`,
            );
            if (failFast) break;
          }
        }
        if (failFast && !report.passed) break;
      }
      if (failFast && !report.passed) break;
    }
    if (failFast && !report.passed) break;
  }

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMatrixMarkdown(report));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        jsonReport: jsonPath,
        markdownReport: markdownPath,
        benchmarkCases: report.results.length,
        planCases: report.plans.length,
        failures: report.failures.length,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 2;
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
