const dotenv = require("dotenv");
const { Pool } = require("pg");
const { withPostgresOptions } = require("./lib/postgres-options");

dotenv.config({ path: ".env", override: false, quiet: true });

const readNumber = (name, fallback, min, max) => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

const lat = readNumber("COMPARE_LAT", 35.6892, -90, 90);
const lng = readNumber("COMPARE_LNG", 51.389, -180, 180);
const maxDistance = readNumber("COMPARE_MAX_DISTANCE_METERS", 10000, 1, 1000000);
const limit = Math.trunc(readNumber("COMPARE_LIMIT", 20, 1, 200));
const ttlDays = Math.trunc(readNumber("LOCATION_TTL_DAYS", 7, 1, 3650));
const distanceScale = readNumber("RANKING_DISTANCE_SCALE_METERS", 2000, 1, 10000000);
const halfLifeMinutes = readNumber("RANKING_FRESHNESS_HALF_LIFE_MINUTES", 60, 0.01, 525600);
const distanceWeight = readNumber("RANKING_DISTANCE_WEIGHT", 0.65, 0, 1000000);
const freshnessWeight = readNumber("RANKING_FRESHNESS_WEIGHT", 0.35, 0, 1000000);
if (distanceWeight + freshnessWeight <= 0) {
  throw new Error("At least one ranking weight must be greater than zero");
}

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/nearby-location";
const pool = new Pool(withPostgresOptions({ connectionString: databaseUrl, max: 1 }));

const sql = `
  WITH params AS (
    SELECT
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog,
      now() AS ranked_at
  ), candidates AS (
    SELECT
      l.user_id,
      ST_Distance(l.geom, p.geog) AS distance,
      l.updated_at,
      p.ranked_at
    FROM locations l
    CROSS JOIN params p
    WHERE ST_DWithin(l.geom, p.geog, $3)
      AND l.updated_at >= p.ranked_at - make_interval(days => $4::int)
      AND l.updated_at <= p.ranked_at
  ), scored AS (
    SELECT
      user_id,
      distance,
      updated_at,
      (
        1.0 / (distance + 1)
        + (EXTRACT(EPOCH FROM updated_at) * 1000.0) / 1e10
      )::double precision AS legacy_score,
      (
        (
          $5::double precision * EXP(-distance / $6::double precision)
          + $7::double precision * POWER(
              0.5::double precision,
              GREATEST(
                EXTRACT(EPOCH FROM (ranked_at - updated_at))::double precision,
                0.0
              ) / ($8::double precision * 60.0)
            )
        ) / NULLIF($5::double precision + $7::double precision, 0.0)
      )::double precision AS decay_score
    FROM candidates
  ), ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (ORDER BY legacy_score DESC, user_id ASC) AS legacy_rank,
      ROW_NUMBER() OVER (ORDER BY decay_score DESC, user_id ASC) AS decay_rank
    FROM scored
  )
  SELECT
    user_id,
    ROUND(distance::numeric, 1)::double precision AS distance_m,
    updated_at,
    ROUND(legacy_score::numeric, 6)::double precision AS legacy_score,
    legacy_rank,
    ROUND(decay_score::numeric, 6)::double precision AS decay_score,
    decay_rank,
    (legacy_rank - decay_rank) AS rank_change
  FROM ranked
  WHERE legacy_rank <= $9 OR decay_rank <= $9
  ORDER BY decay_rank ASC, legacy_rank ASC
`;

(async () => {
  try {
    const result = await pool.query(sql, [
      lng,
      lat,
      maxDistance,
      ttlDays,
      distanceWeight,
      distanceScale,
      freshnessWeight,
      halfLifeMinutes,
      limit,
    ]);
    console.table(result.rows);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
