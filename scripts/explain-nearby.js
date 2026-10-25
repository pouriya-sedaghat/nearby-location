const dotenv = require("dotenv");
const { summarizePlan } = require("./lib/explain-summary");
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

const readOptionalNumber = (name, min, max) => {
  if (process.env[name] === undefined || process.env[name] === "") return undefined;
  return readNumber(name, 0, min, max);
};

const readBoolean = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
};

const lat = readNumber("EXPLAIN_LAT", 35.6892, -90, 90);
const lng = readNumber("EXPLAIN_LNG", 51.389, -180, 180);
const maxDistance = readNumber("EXPLAIN_MAX_DISTANCE_METERS", 10000, 1, 1000000);
const limit = Math.trunc(readNumber("EXPLAIN_LIMIT", 20, 1, 1000));
const ttlDays = Math.trunc(readNumber("LOCATION_TTL_DAYS", 7, 1, 3650));
const rankingMode = process.env.RANKING_MODE === "decay" ? "decay" : "legacy";
const distanceScale = readNumber("RANKING_DISTANCE_SCALE_METERS", 2000, 1, 10000000);
const halfLifeMinutes = readNumber("RANKING_FRESHNESS_HALF_LIFE_MINUTES", 60, 0.01, 525600);
const distanceWeight = readNumber("RANKING_DISTANCE_WEIGHT", 0.65, 0, 1000000);
const freshnessWeight = readNumber("RANKING_FRESHNESS_WEIGHT", 0.35, 0, 1000000);
if (distanceWeight + freshnessWeight <= 0) {
  throw new Error("At least one ranking weight must be greater than zero");
}

const output = (process.env.EXPLAIN_OUTPUT ?? "text").toLowerCase();
if (!new Set(["text", "json"]).has(output)) {
  throw new Error("EXPLAIN_OUTPUT must be text or json");
}
const requireGist = readBoolean("EXPLAIN_REQUIRE_GIST_INDEX", false);
const includePlan = readBoolean("EXPLAIN_INCLUDE_PLAN", false);
const queryMode = process.env.EXPLAIN_QUERY_MODE ?? "ranking_probe";
if (!new Set(["ranking_probe", "cursor_first", "cursor_next"]).has(queryMode)) {
  throw new Error("EXPLAIN_QUERY_MODE must be ranking_probe, cursor_first or cursor_next");
}
const maxExecutionMs = readOptionalNumber("EXPLAIN_MAX_EXECUTION_MS", 0.01, 600000);

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/nearby-location";
const pool = new Pool(withPostgresOptions({
  connectionString: databaseUrl,
  max: 1,
  application_name: "nearby-explain",
}));

const scoreSql = rankingMode === "decay"
  ? `(
      (
        $6::double precision * EXP(-distance / $5::double precision)
        + $7::double precision * POWER(
            0.5::double precision,
            GREATEST(
              EXTRACT(EPOCH FROM (ranked_at - updated_at))::double precision,
              0.0
            ) / ($8::double precision * 60.0)
          )
      ) / NULLIF($6::double precision + $7::double precision, 0.0)
    )::double precision`
  : `(
      1.0 / (distance + 1)
      + (EXTRACT(EPOCH FROM updated_at) * 1000.0) / 1e10
    )::double precision`;

const freshnessFilter = rankingMode === "decay"
  ? `AND l.updated_at >= p.ranked_at - make_interval(days => $4::int)
     AND l.updated_at <= p.ranked_at`
  : "AND l.updated_at >= now() - make_interval(days => $4::int)";

const explainFormat = output === "json" ? "JSON" : "TEXT";
const sql = `
  EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT ${explainFormat})
  WITH params AS (
    SELECT
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog,
      now() AS ranked_at,
      $5::double precision AS ranking_distance_scale,
      $6::double precision AS ranking_distance_weight,
      $7::double precision AS ranking_freshness_weight,
      $8::double precision AS ranking_half_life
  ), candidates AS (
    SELECT
      l.user_id,
      ST_Distance(l.geom, p.geog) AS distance,
      l.updated_at,
      p.ranked_at
    FROM locations l
    CROSS JOIN params p
    WHERE ST_DWithin(l.geom, p.geog, $3)
      ${freshnessFilter}
  ), ranked AS (
    SELECT user_id, distance, updated_at, ranked_at, ${scoreSql} AS score
    FROM candidates
  )
  SELECT user_id, distance, updated_at
  FROM ranked
  ORDER BY score DESC, user_id ASC
  LIMIT $9
`;

const queryForExplain = async () => {
  if (queryMode !== "ranking_probe") {
    const { buildNearbyCursorQuery } = require("../dist/models/location.model");
    let explained = buildNearbyCursorQuery(lat, lng, maxDistance, limit);
    if (queryMode === "cursor_next") {
      const first = await pool.query(explained.query, explained.values);
      if (first.rows.length <= limit) throw new Error("cursor_next requires more than one page of matching locations");
      const last = first.rows[limit - 1];
      explained = buildNearbyCursorQuery(lat, lng, maxDistance, limit, Number(last.score),
        String(last.user_id), undefined, new Date(last.ranked_at), Number(last.total_count));
    }
    const { query, values } = explained;
    return { sql: `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT ${explainFormat}) ${query}`, values };
  }
  return { sql, values: [lng, lat, maxDistance, ttlDays, distanceScale, distanceWeight, freshnessWeight, halfLifeMinutes, limit] };
};

(async () => {
  try {
    console.error(`Ranking mode: ${rankingMode}`);
    const explained = await queryForExplain();
    const result = await pool.query(explained.sql, explained.values);

    if (output === "text") {
      for (const row of result.rows) console.log(row["QUERY PLAN"]);
      return;
    }

    let planDocument = result.rows[0]?.["QUERY PLAN"];
    if (typeof planDocument === "string") planDocument = JSON.parse(planDocument);
    const document = Array.isArray(planDocument) ? planDocument[0] : planDocument;
    if (!document?.Plan) throw new Error("Unexpected EXPLAIN JSON response");

    const aggregate = summarizePlan(document.Plan);
    const indexes = aggregate.indexes;
    const summary = {
      rankingMode,
      queryMode,
      configuration: { lat, lng, maxDistance, limit, ttlDays },
      planningTimeMs: Number(document["Planning Time"] ?? 0),
      executionTimeMs: Number(document["Execution Time"] ?? 0),
      rootActualRows: Number(document.Plan["Actual Rows"] ?? 0),
      rootActualTotalTimeMs: Number(document.Plan["Actual Total Time"] ?? 0),
      jit: document.JIT ?? null,
      nodeTypes: aggregate.nodeTypes,
      indexes,
      usesLocationsGistIndex: indexes.includes("locations_geom_gist_idx"),
      buffers: aggregate.buffers,
      ...(includePlan ? { plan: document.Plan } : {}),
      constraints: {
        requireGistIndex: requireGist,
        maxExecutionMs: maxExecutionMs ?? null,
      },
    };

    console.log(JSON.stringify(summary, null, 2));

    const failures = [];
    if (requireGist && !summary.usesLocationsGistIndex) {
      failures.push("locations_geom_gist_idx was not used");
    }
    if (
      maxExecutionMs !== undefined &&
      summary.executionTimeMs > maxExecutionMs
    ) {
      failures.push(
        `execution ${summary.executionTimeMs}ms exceeded ${maxExecutionMs}ms`,
      );
    }

    if (failures.length > 0) {
      console.error(`Plan verification failed: ${failures.join("; ")}`);
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
