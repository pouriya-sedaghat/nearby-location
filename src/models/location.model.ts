import { PoolClient } from "pg";
import { config } from "../config/env";
import { pool } from "../utils/db";
import { rankingProfile } from "../config/ranking";

export interface NearbyLocation {
  userId: string;
  /** Stored WGS84 position of this result user, not the search center. */
  coordinate: { lat: number; lng: number };
  distance: number;
  updatedAt: Date;
  /** Internal stable sort key used to build opaque cursors. */
  score: number;
}

export interface FindNearbyResult {
  data: NearbyLocation[];
  totalCount: number;
  /** Database-clock snapshot used by decay ranking/cursors. */
  rankingReferenceTime?: Date;
}

export interface FindNearbyCursorResult extends FindNearbyResult {
  hasMore: boolean;
}

/**
 * Creates or updates a user's location.
 * geography(Point,4326) columns take (lng, lat) order, matching GeoJSON.
 */
export const upsertLocation = async (
  userId: string,
  lat: number,
  lng: number,
): Promise<void> => {
  await pool.query(
    `
    INSERT INTO locations (user_id, geom, updated_at)
    VALUES (
      $1,
      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
      now()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      geom = EXCLUDED.geom,
      updated_at = EXCLUDED.updated_at
    `,
    [userId, lng, lat],
  );
};

const legacyScoreSql = `
  (
    1.0 / (distance + 1)
    + (EXTRACT(EPOCH FROM updated_at) * 1000.0) / 1e10
  )::double precision
`;

const buildDecayScoreSql = (
  referenceTimeExpression: string,
  distanceScaleParam: number,
  halfLifeParam: number,
  distanceWeightParam: number,
  freshnessWeightParam: number,
) => `
  (
    (
      $${distanceWeightParam}::double precision
        * EXP(-distance / $${distanceScaleParam}::double precision)
      + $${freshnessWeightParam}::double precision
        * POWER(
            0.5::double precision,
            GREATEST(
              EXTRACT(EPOCH FROM (
                ${referenceTimeExpression} - updated_at
              ))::double precision,
              0.0
            ) / ($${halfLifeParam}::double precision * 60.0)
          )
    ) / NULLIF(
      $${distanceWeightParam}::double precision
        + $${freshnessWeightParam}::double precision,
      0.0
    )
  )::double precision
`;

const buildRankingScoreSql = (
  referenceTimeExpression: string,
  distanceScaleParam: number,
  halfLifeParam: number,
  distanceWeightParam: number,
  freshnessWeightParam: number,
) =>
  rankingProfile.mode === "decay"
    ? buildDecayScoreSql(
        referenceTimeExpression,
        distanceScaleParam,
        halfLifeParam,
        distanceWeightParam,
        freshnessWeightParam,
      )
    : legacyScoreSql;

const buildFreshnessFilterSql = (
  ttlDaysParam: number,
  referenceTimeExpression: string,
) =>
  rankingProfile.mode === "decay"
    ? `AND l.updated_at >= ${referenceTimeExpression}
         - make_interval(days => $${ttlDaysParam}::int)
       AND l.updated_at <= ${referenceTimeExpression}`
    : `AND l.updated_at >= now()
         - make_interval(days => $${ttlDaysParam}::int)`;

const buildRankingValues = (referenceTime?: Date) => [
  referenceTime?.toISOString() ?? null,
  rankingProfile.distanceScaleMeters,
  rankingProfile.freshnessHalfLifeMinutes,
  rankingProfile.distanceWeight,
  rankingProfile.freshnessWeight,
];

const resolveRankingReferenceTime = (referenceTime?: Date): Date | undefined =>
  rankingProfile.mode === "decay" ? referenceTime : undefined;

// pg converts timestamptz to JavaScript Date, losing microseconds. Compute the
// first page with the same millisecond precision carried by subsequent cursors.
// Use an upper bound so a location just committed within this millisecond is
// still visible. This changes the reference clock by at most one millisecond.
const rankingReferenceClockSql = rankingProfile.mode === "decay"
  ? "date_trunc('milliseconds', now()) + interval '1 millisecond'"
  : "now()";

const rowRankingReferenceTime = (
  rows: Array<Record<string, unknown>>,
  fallback?: Date,
): Date | undefined => {
  // `ranked_at` is sourced from the PostgreSQL clock in both ranking modes.
  // Decay uses it for score stability; legacy uses it as the cursor issuance
  // clock so app/DB clock skew does not create false expiry/future failures.
  const value = rows[0]?.ranked_at;
  return value ? new Date(value as string | Date) : fallback;
};

const mapNearbyRows = (rows: Array<Record<string, unknown>>): NearbyLocation[] =>
  rows.map((row) => ({
    userId: String(row.user_id),
    coordinate: { lat: Number(row.lat), lng: Number(row.lng) },
    distance: Number(row.distance),
    updatedAt: row.updated_at as Date,
    score: Number(row.score),
  }));

/**
 * Offset pagination retained for API compatibility.
 *
 * Candidate selection is always bounded by ST_DWithin so the GiST index can
 * reduce the working set before ST_Distance and ranking are evaluated.
 * Stale rows are excluded at read time; the cleanup job is maintenance only.
 * Materializing candidates evaluates the geodesic distance once per match.
 * The small paged relation delays geometry-to-coordinate conversion until
 * after sorting/limiting; ranked stays inline so COUNT does not copy it again.
 */
export const findNearby = async (
  lat: number,
  lng: number,
  maxDistance: number,
  skip: number,
  limit: number,
  excludeUserId?: string,
  rankingReferenceTime?: Date,
): Promise<FindNearbyResult> => {
  const referenceTime = resolveRankingReferenceTime(rankingReferenceTime);
  const values = [
    lng,
    lat,
    maxDistance,
    skip,
    limit,
    config.LOCATION_TTL_DAYS,
    excludeUserId ?? null,
    ...buildRankingValues(referenceTime),
  ];

  const pageQuery = `
    WITH params AS (
      SELECT
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog,
        COALESCE($8::timestamptz, ${rankingReferenceClockSql}) AS ranked_at,
        $9::double precision AS ranking_distance_scale,
        $10::double precision AS ranking_half_life,
        $11::double precision AS ranking_distance_weight,
        $12::double precision AS ranking_freshness_weight
    ), candidates AS MATERIALIZED (
      SELECT
        l.user_id,
        l.geom,
        ST_Distance(l.geom, p.geog) AS distance,
        l.updated_at,
        p.ranked_at
      FROM locations l
      CROSS JOIN params p
      WHERE ST_DWithin(l.geom, p.geog, $3)
        ${buildFreshnessFilterSql(6, "p.ranked_at")}
        AND ($7::text IS NULL OR l.user_id <> $7)
    ), ranked AS NOT MATERIALIZED (
      SELECT
        user_id,
        geom,
        distance,
        updated_at,
        ranked_at,
        ${buildRankingScoreSql("ranked_at", 9, 10, 11, 12)} AS score
      FROM candidates
    ), paged AS MATERIALIZED (
      SELECT
        user_id, geom, distance, updated_at, ranked_at, score,
        COUNT(*) OVER() AS total_count
      FROM ranked
      ORDER BY score DESC, user_id ASC
      OFFSET $4
      LIMIT $5
    )
    SELECT
      user_id,
      ST_Y(geom::geometry) AS lat,
      ST_X(geom::geometry) AS lng,
      distance,
      updated_at,
      ranked_at,
      score,
      total_count
    FROM paged
    ORDER BY score DESC, user_id ASC
  `;

  const { rows } = await pool.query(pageQuery, values);
  let totalCount = rows[0]?.total_count ? Number(rows[0].total_count) : 0;

  // A window count cannot be returned when OFFSET is beyond the final row.
  // Preserve the real total count with a fallback only for that edge case.
  if (rows.length === 0 && skip > 0) {
    const countQuery = `
      WITH params AS (
        SELECT
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog,
          COALESCE($6::timestamptz, ${rankingReferenceClockSql}) AS ranked_at
      )
      SELECT COUNT(*) AS total_count
      FROM locations l
      CROSS JOIN params p
      WHERE ST_DWithin(l.geom, p.geog, $3)
        ${buildFreshnessFilterSql(4, "p.ranked_at")}
        AND ($5::text IS NULL OR l.user_id <> $5)
    `;
    const countValues = [
      lng,
      lat,
      maxDistance,
      config.LOCATION_TTL_DAYS,
      excludeUserId ?? null,
      referenceTime?.toISOString() ?? null,
    ];

    const countResult = await pool.query(countQuery, countValues);
    totalCount = Number(countResult.rows[0]?.total_count ?? 0);
  }

  return {
    data: mapNearbyRows(rows),
    totalCount,
    rankingReferenceTime: rowRankingReferenceTime(rows, referenceTime),
  };
};

/**
 * Keyset/cursor pagination for large result sets. The cursor is the exact
 * (score, user_id) sort tuple from the previous page. Decay ranking also pins
 * one ranking reference time across pages so the time-decay component itself
 * cannot drift while the client advances through a cursor session.
 */
/**
 * Shared by the API and read-only EXPLAIN tooling to prevent SQL drift.
 * Keep distance materialized and coordinate extraction outside the page limit.
 */
export const buildNearbyCursorQuery = (
  lat: number,
  lng: number,
  maxDistance: number,
  limit: number,
  cursorScore?: number,
  cursorUserId?: string,
  excludeUserId?: string,
  rankingReferenceTime?: Date,
  knownTotalCount?: number,
) => {
  const referenceTime = resolveRankingReferenceTime(rankingReferenceTime);
  const values = [
    lng,
    lat,
    maxDistance,
    cursorScore ?? null,
    cursorUserId ?? null,
    limit + 1,
    config.LOCATION_TTL_DAYS,
    excludeUserId ?? null,
    ...buildRankingValues(referenceTime),
    ...(knownTotalCount !== undefined ? [knownTotalCount] : []),
  ];

  const totalCountSql =
    knownTotalCount !== undefined
      ? "$14::bigint"
      : "(SELECT COUNT(*) FROM ranked)";

  const query = `
    WITH params AS (
      SELECT
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog,
        COALESCE($9::timestamptz, ${rankingReferenceClockSql}) AS ranked_at,
        $10::double precision AS ranking_distance_scale,
        $11::double precision AS ranking_half_life,
        $12::double precision AS ranking_distance_weight,
        $13::double precision AS ranking_freshness_weight
    ), candidates AS MATERIALIZED (
      SELECT
        l.user_id,
        l.geom,
        ST_Distance(l.geom, p.geog) AS distance,
        l.updated_at,
        p.ranked_at
      FROM locations l
      CROSS JOIN params p
      WHERE ST_DWithin(l.geom, p.geog, $3)
        ${buildFreshnessFilterSql(7, "p.ranked_at")}
        AND ($8::text IS NULL OR l.user_id <> $8)
    ), ranked AS NOT MATERIALIZED (
      SELECT
        user_id,
        geom,
        distance,
        updated_at,
        ranked_at,
        ${buildRankingScoreSql("ranked_at", 10, 11, 12, 13)} AS score
      FROM candidates
    ), paged AS MATERIALIZED (
      SELECT user_id, geom, distance, updated_at, ranked_at, score
      FROM ranked
      WHERE (
        $4::double precision IS NULL
        OR score < $4::double precision
        OR (score = $4::double precision AND user_id > $5::text)
      )
      ORDER BY score DESC, user_id ASC
      LIMIT $6
    )
    SELECT
      user_id,
      ST_Y(geom::geometry) AS lat,
      ST_X(geom::geometry) AS lng,
      distance,
      updated_at,
      ranked_at,
      score,
      ${totalCountSql} AS total_count
    FROM paged
    ORDER BY score DESC, user_id ASC
  `;

  return { query, values };
};

export const findNearbyByCursor = async (
  lat: number,
  lng: number,
  maxDistance: number,
  limit: number,
  cursorScore?: number,
  cursorUserId?: string,
  excludeUserId?: string,
  rankingReferenceTime?: Date,
  knownTotalCount?: number,
): Promise<FindNearbyCursorResult> => {
  const referenceTime = resolveRankingReferenceTime(rankingReferenceTime);
  const { query, values } = buildNearbyCursorQuery(
    lat, lng, maxDistance, limit, cursorScore, cursorUserId,
    excludeUserId, rankingReferenceTime, knownTotalCount,
  );
  const { rows } = await pool.query(query, values);
  let totalCount =
    knownTotalCount ??
    (rows[0]?.total_count ? Number(rows[0].total_count) : 0);

  // Legacy v1/v2 cursors do not carry totalCount. The scalar count has nowhere
  // to appear when such a cursor is already beyond the final row, so preserve
  // compatibility with one fallback count in that terminal-page edge case.
  if (
    knownTotalCount === undefined &&
    rows.length === 0 &&
    cursorScore !== undefined
  ) {
    const countQuery = `
      WITH params AS (
        SELECT
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog,
          COALESCE($6::timestamptz, ${rankingReferenceClockSql}) AS ranked_at
      )
      SELECT COUNT(*) AS total_count
      FROM locations l
      CROSS JOIN params p
      WHERE ST_DWithin(l.geom, p.geog, $3)
        ${buildFreshnessFilterSql(4, "p.ranked_at")}
        AND ($5::text IS NULL OR l.user_id <> $5)
    `;
    const countValues = [
      lng,
      lat,
      maxDistance,
      config.LOCATION_TTL_DAYS,
      excludeUserId ?? null,
      referenceTime?.toISOString() ?? null,
    ];
    const countResult = await pool.query(countQuery, countValues);
    totalCount = Number(countResult.rows[0]?.total_count ?? 0);
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: mapNearbyRows(pageRows),
    totalCount,
    hasMore,
    rankingReferenceTime: rowRankingReferenceTime(pageRows, referenceTime),
  };
};

/**
 * Permanently deletes the current live location row for one user.
 *
 * This is deliberately a hard delete rather than a soft-delete marker so the
 * location table does not retain the identifier after an erasure request. The
 * caller must stop/revoke upstream location publishing before invoking this
 * operation; otherwise a delayed/new upsert can legitimately recreate the row.
 */
export const deleteUserLocation = async (userId: string): Promise<boolean> => {
  const result = await pool.query(
    `DELETE FROM locations WHERE user_id = $1`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
};

/**
 * Deletes locations that haven't been updated in `maxAgeDays` days.
 * Replaces the MongoDB TTL index (expireAfterSeconds), since Postgres
 * has no native row-expiry mechanism. Intended to be run periodically.
 */
export const deleteStaleLocations = async (
  maxAgeDays: number,
  batchSize: number,
  existingClient?: PoolClient,
): Promise<number> => {
  const client = existingClient ?? (await pool.connect());
  const ownsClient = !existingClient;
  let discardClient = false;

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)",
      [
        `${config.CLEANUP_STATEMENT_TIMEOUT_MS}ms`,
        `${config.CLEANUP_LOCK_TIMEOUT_MS}ms`,
      ],
    );

    const { rowCount } = await client.query(
      `
      WITH stale AS (
        SELECT ctid
        FROM locations
        WHERE updated_at < now() - make_interval(days => $1::int)
        ORDER BY updated_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM locations l
      USING stale
      WHERE l.ctid = stale.ctid
        AND l.updated_at < now() - make_interval(days => $1::int)
      `,
      [maxAgeDays, batchSize],
    );

    await client.query("COMMIT");
    return rowCount ?? 0;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A failed rollback leaves the transaction state uncertain. Destroy an
      // owned client; the advisory-lock owner handles a borrowed client.
      discardClient = true;
    }
    throw err;
  } finally {
    if (ownsClient) client.release(discardClient);
  }
};

const Location = {
  upsertLocation,
  findNearby,
  findNearbyByCursor,
  deleteUserLocation,
  deleteStaleLocations,
};

export default Location;
