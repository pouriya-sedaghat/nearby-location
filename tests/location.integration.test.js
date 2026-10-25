const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

if (!databaseUrl) {
  test("PostGIS integration tests", { skip: "Set INTEGRATION_DATABASE_URL" }, () => {});
} else {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.LOCATION_TTL_DAYS = "7";
  process.env.DEFAULT_MAX_DISTANCE_METERS = "10000";
  process.env.MAX_MAX_DISTANCE_METERS = "100000";
  process.env.PG_STATEMENT_TIMEOUT_MS = "5000";

  const migration = spawnSync(
    process.execPath,
    ["scripts/run-migration.js", "up"],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  if (migration.status !== 0) {
    throw new Error(
      `Integration migration failed:\n${migration.stdout || ""}\n${migration.stderr || ""}`,
    );
  }

  const { parseConfig } = require("../dist/config/env");
  const config = parseConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, PG_STATEMENT_TIMEOUT_MS: "5000" });
  const database = require("../dist/utils/db").createDatabase(config);
  const { pool } = database;
  const { LocationRepository, buildNearbyQuery } = require("../dist/models/location.model");
  const Location = new LocationRepository(pool, config.LOCATION_TTL_DAYS);
  const fs = require("node:fs");
  const path = require("node:path");

  const center = { lat: 35.6892, lng: 51.389 };

  test.beforeEach(async () => {
    await pool.query("TRUNCATE TABLE locations RESTART IDENTITY");
  });

  test.after(async () => {
    await pool.query("TRUNCATE TABLE locations RESTART IDENTITY");
    await pool.end();
  });

  test("upsert keeps one current location per user", async () => {
    await Location.upsertLocation("user_1", center.lat, center.lng);
    await Location.upsertLocation("user_1", center.lat + 0.01, center.lng);

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM locations WHERE user_id = $1",
      ["user_1"],
    );

    assert.equal(rows[0].count, 1);
  });

  test("nearby search is radius bounded and can exclude the requester", async () => {
    await Location.upsertLocation("self", center.lat, center.lng);
    await Location.upsertLocation("near", center.lat + 0.01, center.lng);
    await Location.upsertLocation("far", center.lat + 0.2, center.lng);

    const result = await Location.findNearby(
      center.lat,
      center.lng,
      5_000,
      0,
      10,
      "self",
    );

    assert.equal(result.totalCount, 1);
    assert.deepEqual(result.data.map((row) => row.userId), ["near"]);
    assert.ok(result.data[0].distance > 0);
    assert.ok(result.data[0].distance < 5_000);
    assert.deepEqual(result.data[0].coordinate, { lat: center.lat + 0.01, lng: center.lng });
  });

  test("stale locations are excluded before the cleanup job runs", async () => {
    await Location.upsertLocation("fresh", center.lat + 0.005, center.lng);
    await Location.upsertLocation("stale", center.lat + 0.006, center.lng);

    await pool.query(
      "UPDATE locations SET updated_at = now() - interval '8 days' WHERE user_id = $1",
      ["stale"],
    );

    const result = await Location.findNearby(
      center.lat,
      center.lng,
      5_000,
      0,
      10,
    );

    assert.equal(result.totalCount, 1);
    assert.deepEqual(result.data.map((row) => row.userId), ["fresh"]);
  });

  test("out-of-range page keeps the real totalCount", async () => {
    await Location.upsertLocation("near_1", center.lat + 0.001, center.lng);
    await Location.upsertLocation("near_2", center.lat + 0.002, center.lng);
    await Location.upsertLocation("near_3", center.lat + 0.003, center.lng);

    const result = await Location.findNearby(
      center.lat,
      center.lng,
      5_000,
      100,
      10,
    );

    assert.equal(result.data.length, 0);
    assert.equal(result.totalCount, 3);
  });

  test("stored coordinates preserve latitude/longitude, zero and negative values", async () => {
    for (const coordinate of [{ lat: 0, lng: 0 }, { lat: -33.9, lng: 151.2 }, { lat: 48.85, lng: -2.3 }]) {
      await pool.query("TRUNCATE TABLE locations RESTART IDENTITY");
      await Location.upsertLocation("coordinate", coordinate.lat, coordinate.lng);
      const result = await Location.findNearby(coordinate.lat, coordinate.lng, 10, 0, 10);
      assert.equal(result.totalCount, 1);
      assert.deepEqual(result.data[0].coordinate, coordinate);
      assert.equal(result.data[0].distance, 0);
    }
  });

  test("distance boundaries include points just inside and exclude points just outside", async () => {
    await Location.upsertLocation("center", center.lat, center.lng);
    await pool.query(`
      INSERT INTO locations (user_id, geom)
      SELECT label, ST_Project(ST_SetSRID(ST_MakePoint($1, $2),4326)::geography, meters, 0)
      FROM (VALUES ('inside', 999.99), ('outside', 1000.01)) points(label, meters)
    `, [center.lng, center.lat]);
    const result = await Location.findNearby(center.lat, center.lng, 1000, 0, 10);
    assert.equal(result.totalCount, 2);
    assert.deepEqual(result.data.map((row) => row.userId).sort(), ["center", "inside"]);
  });

  test("optimized SQL matches supplied ordering, distances, counts and timestamps", async () => {
    await pool.query(`
      INSERT INTO locations (user_id, geom, updated_at)
      SELECT 'fixture-' || n,
        ST_SetSRID(ST_MakePoint($1 + (n % 13) * 0.0001, $2 + (n % 17) * 0.0001), 4326)::geography,
        now() - ((n % 5)::text || ' hours')::interval
      FROM generate_series(1, 80) n
    `, [center.lng, center.lat]);
    await Location.upsertLocation("tie-a", center.lat, center.lng);
    await Location.upsertLocation("tie-b", center.lat, center.lng);
    // Give both ties the same fresh timestamp, independent of the current date.
    await pool.query("UPDATE locations SET updated_at = now() WHERE user_id LIKE 'tie-%'");
    await Location.upsertLocation("stale", center.lat, center.lng);
    await pool.query("UPDATE locations SET updated_at = now() - interval '8 days' WHERE user_id = 'stale'");
    const baseline = fs.readFileSync(path.join(__dirname, "../scripts/fixtures/nearby-baseline.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      for (const radius of [1, 50, 5000]) {
        for (const [skip, limit, exclude] of [[0, 1, undefined], [0, 10, "tie-a"], [10, 7, undefined], [1000, 5, undefined]]) {
          const current = buildNearbyQuery(config.LOCATION_TTL_DAYS, center.lat, center.lng, radius, skip, limit, exclude);
          const before = (await client.query(baseline, current.values)).rows;
          const after = (await client.query(current.query, current.values)).rows;
          const project = (rows) => rows.map(({ user_id, distance, updated_at, total_count }) => ({ user_id, distance, updated_at, total_count }));
          assert.deepEqual(project(after), project(before));
          for (const row of after) assert.ok(Number.isFinite(row.lat) && Number.isFinite(row.lng));
        }
      }
      await client.query("COMMIT");
    } finally { client.release(); }
  });

  test("the real plan calculates distance once per candidate and coordinates only for page rows", async () => {
    await pool.query(`
      INSERT INTO locations (user_id, geom)
      SELECT 'plan-' || n, ST_SetSRID(ST_MakePoint($1 + n * 0.00001, $2), 4326)::geography
      FROM generate_series(1, 500) n
    `, [center.lng, center.lat]);
    const { query, values } = buildNearbyQuery(config.LOCATION_TTL_DAYS, center.lat, center.lng, 5000, 0, 5);
    const { rows } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${query}`, values);
    const plan = rows[0]["QUERY PLAN"][0].Plan;
    const nodes = [];
    const walk = (node) => { nodes.push(node); (node.Plans || []).forEach(walk); };
    walk(plan);
    const distanceNodes = nodes.filter((node) => (node.Output || []).some((output) => /st_distance\(/i.test(output)));
    assert.equal(distanceNodes.length, 1);
    assert.equal(distanceNodes[0]["Actual Rows"], 500);
    const projectionNodes = nodes.filter((node) => (node.Output || []).some((output) => /st_[xy]\(/i.test(output)));
    assert.ok(projectionNodes.length > 0);
    for (const node of projectionNodes) assert.ok(node["Actual Rows"] <= 5);
  });
}
