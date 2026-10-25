// Read-only comparison of the exact supplied SQL with the current API SQL.
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const config = require("../dist/config/env").loadConfig();
const { pool } = require("../dist/utils/db").createDatabase(config);
const { buildNearbyQuery } = require("../dist/models/location.model");
const findNearbyReqSchema = require("../dist/schemas/request.schema").createNearbyRequestSchema(config);
function option(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value.trim() === "" || !Number.isFinite(Number(value))) throw new Error(`Invalid ${name}`);
  return Number(value);
}
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
const summary = (values) => ({ samples: values.length, p50_ms: quantile(values, 0.5), p95_ms: quantile(values, 0.95), mean_ms: values.reduce((a, b) => a + b, 0) / values.length });
async function main() {
  const input = findNearbyReqSchema.parse({
    coordinate: { lat: option("BENCHMARK_LAT", 35.6892), lng: option("BENCHMARK_LNG", 51.389) },
    maxDistance: option("BENCHMARK_RADIUS_METERS", 5000),
    page: option("BENCHMARK_PAGE", 1), pageSize: option("BENCHMARK_PAGE_SIZE", 10),
    excludeUserId: process.env.BENCHMARK_EXCLUDE_USER_ID,
  });
  const iterations = option("BENCHMARK_ITERATIONS", 30);
  if (!Number.isInteger(iterations) || iterations < 5 || iterations > 10000) throw new Error("BENCHMARK_ITERATIONS must be an integer from 5 to 10000");
  const current = buildNearbyQuery(config.LOCATION_TTL_DAYS, input.coordinate.lat, input.coordinate.lng, input.maxDistance,
    (input.page - 1) * input.pageSize, input.pageSize, input.excludeUserId);
  const baseline = fs.readFileSync(path.join(__dirname, "fixtures/nearby-baseline.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const oldRows = (await client.query(baseline, current.values)).rows;
    const newRows = (await client.query(current.query, current.values)).rows;
    const project = (rows) => rows.map(({ user_id, distance, updated_at, total_count }) => ({ user_id, distance, updated_at, total_count }));
    require("node:assert/strict").deepEqual(project(newRows), project(oldRows));
    const samples = { supplied: [], optimized: [] };
    const measure = async (name) => {
      const start = performance.now();
      await client.query(name === "supplied" ? baseline : current.query, current.values);
      return performance.now() - start;
    };
    for (let i = 0; i < 5; i++) { await measure("supplied"); await measure("optimized"); }
    for (let i = 0; i < iterations; i++) {
      const order = i % 2 ? ["optimized", "supplied"] : ["supplied", "optimized"];
      for (const name of order) samples[name].push(await measure(name));
    }
    const plans = {};
    if (process.env.BENCHMARK_EXPLAIN === "true") {
      for (const name of ["supplied", "optimized"]) {
        const sql = name === "supplied" ? baseline : current.query;
        plans[name] = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${sql}`, current.values)).rows[0]["QUERY PLAN"][0];
      }
    }
    const result = {
      version: require("../package.json").version,
      database: (await client.query("SELECT version() AS version, postgis_full_version() AS postgis")).rows[0],
      jit: (await client.query("SHOW jit")).rows[0].jit,
      input, equivalent: true, page_rows: newRows.length,
      total_count: newRows[0] ? Number(newRows[0].total_count) : null,
      supplied: summary(samples.supplied), optimized: summary(samples.optimized),
      note: "Sequential warm SQL timings on one fixed read-only snapshot. The optimized query also returns coordinates. Not an HTTP capacity or concurrency test. Empty/out-of-range pages have no window count here; the API's fallback is covered by integration tests.",
      ...(process.env.BENCHMARK_EXPLAIN === "true" ? { plans } : {}),
    };
    await client.query("COMMIT");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
