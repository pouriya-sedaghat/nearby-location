const dotenv = require("dotenv");
const { Pool } = require("pg");
const { withPostgresOptions } = require("./lib/postgres-options");

dotenv.config({ path: ".env", override: false, quiet: true });

const readNumber = (name, fallback, min, max, integer = false) => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return integer ? Math.trunc(value) : value;
};

const databaseUrl =
  process.env.BENCHMARK_SEED_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Set BENCHMARK_SEED_DATABASE_URL (recommended) or DATABASE_URL to a disposable benchmark database",
  );
}

const count = readNumber("BENCHMARK_SEED_COUNT", 100_000, 1, 20_000_000, true);
const batchSize = readNumber(
  "BENCHMARK_SEED_BATCH_SIZE",
  25_000,
  1,
  500_000,
  true,
);
const lat = readNumber("BENCHMARK_SEED_LAT", 35.6892, -90, 90);
const lng = readNumber("BENCHMARK_SEED_LNG", 51.389, -180, 180);
const radiusMeters = readNumber(
  "BENCHMARK_SEED_RADIUS_METERS",
  100_000,
  1,
  20_000_000,
);
const freshnessDays = readNumber(
  "BENCHMARK_SEED_FRESHNESS_DAYS",
  7,
  1,
  3650,
  true,
);
const prefix = process.env.BENCHMARK_SEED_USER_PREFIX ?? "bench_";
if (!/^[A-Za-z0-9_.:-]{1,32}$/.test(prefix)) {
  throw new Error(
    "BENCHMARK_SEED_USER_PREFIX must be 1-32 characters from A-Z, a-z, 0-9, _, ., :, -",
  );
}

const shouldTruncate = process.env.BENCHMARK_SEED_TRUNCATE === "true";
if (
  shouldTruncate &&
  process.env.BENCHMARK_SEED_CONFIRM !== "TRUNCATE_LOCATIONS"
) {
  throw new Error(
    "BENCHMARK_SEED_TRUNCATE=true requires BENCHMARK_SEED_CONFIRM=TRUNCATE_LOCATIONS",
  );
}

const shouldAnalyze = process.env.BENCHMARK_SEED_ANALYZE !== "false";
const pool = new Pool(withPostgresOptions({
  connectionString: databaseUrl,
  max: 1,
  application_name: "nearby-benchmark-seed",
}));

const insertSql = `
  WITH center AS (
    SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog
  ), generated AS (
    SELECT
      $3::text || LPAD(g::text, 12, '0') AS user_id,
      ST_Project(
        c.geog,
        SQRT(random()) * $4::double precision,
        random() * 2.0 * pi()
      ) AS geom,
      now() - (make_interval(days => $5::int) * random()) AS updated_at
    FROM generate_series($6::bigint, $7::bigint) AS g
    CROSS JOIN center c
  )
  INSERT INTO locations (user_id, geom, updated_at, created_at)
  SELECT user_id, geom, updated_at, updated_at
  FROM generated
  ON CONFLICT (user_id)
  DO UPDATE SET
    geom = EXCLUDED.geom,
    updated_at = EXCLUDED.updated_at
`;

(async () => {
  const startedAt = process.hrtime.bigint();
  try {
    const prerequisite = await pool.query(`
      SELECT
        to_regclass('public.locations') IS NOT NULL AS has_locations,
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS has_postgis
    `);
    if (!prerequisite.rows[0]?.has_locations) {
      throw new Error("locations table not found; run migrations first");
    }
    if (!prerequisite.rows[0]?.has_postgis) {
      throw new Error("PostGIS extension not found; run migrations first");
    }

    if (shouldTruncate) {
      console.error("Truncating locations table (explicitly confirmed)...");
      await pool.query("TRUNCATE TABLE locations RESTART IDENTITY");
    }

    for (let start = 1; start <= count; start += batchSize) {
      const end = Math.min(count, start + batchSize - 1);
      const batchStarted = process.hrtime.bigint();
      await pool.query(insertSql, [
        lng,
        lat,
        prefix,
        radiusMeters,
        freshnessDays,
        start,
        end,
      ]);
      const batchSeconds =
        Number(process.hrtime.bigint() - batchStarted) / 1_000_000_000;
      console.error(
        `Seeded ${end.toLocaleString()}/${count.toLocaleString()} rows ` +
          `(${batchSeconds.toFixed(2)}s for batch)`,
      );
    }

    if (shouldAnalyze) {
      console.error("Running ANALYZE locations...");
      await pool.query("ANALYZE locations");
    }

    const totals = await pool.query(`
      SELECT
        COUNT(*)::bigint AS total_rows,
        COUNT(*) FILTER (WHERE LEFT(user_id, LENGTH($1)) = $1)::bigint AS seeded_rows
      FROM locations
    `, [prefix]);

    const totalSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    console.log(
      JSON.stringify(
        {
          requestedRows: count,
          batchSize,
          radiusMeters,
          freshnessDays,
          prefix,
          totalRows: Number(totals.rows[0]?.total_rows ?? 0),
          seededRows: Number(totals.rows[0]?.seeded_rows ?? 0),
          analyzed: shouldAnalyze,
          durationSeconds: Number(totalSeconds.toFixed(3)),
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
