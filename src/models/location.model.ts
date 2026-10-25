import type { Pool, QueryResultRow } from "pg";

export interface NearbyLocation {
  userId: string;
  coordinate: { lat: number; lng: number };
  distance: number;
  updatedAt: Date;
}

export interface FindNearbyResult {
  data: NearbyLocation[];
  totalCount: number;
}

const nearbyFilterSql = (ttlParameter: number, excludeParameter: number) => `
  FROM locations l
  CROSS JOIN params p
  WHERE ST_DWithin(l.geom, p.geog, $3)
    AND l.updated_at >= now() - make_interval(days => $${ttlParameter}::int)
    AND ($${excludeParameter}::text IS NULL OR l.user_id <> $${excludeParameter})
`;

/**
 * Finds users near a coordinate, ranked by the legacy proximity + recency
 * scoring formula for API compatibility.
 *
 * Candidate selection is always bounded by ST_DWithin so the GiST index can
 * reduce the working set before ST_Distance and ranking are evaluated.
 * Stale rows are excluded at read time; the cleanup job is maintenance only.
 */
export const buildNearbyQuery = (
  ttlDays: number,
  lat: number,
  lng: number,
  maxDistance: number,
  skip: number,
  limit: number,
  excludeUserId?: string,
) => {
  const values = [
    lng,
    lat,
    maxDistance,
    skip,
    limit,
    ttlDays,
    excludeUserId ?? null,
  ];

  const pageQuery = `
    WITH params AS (
      SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog
    ), candidates AS MATERIALIZED (
      SELECT
        l.user_id,
        l.geom,
        ST_Distance(l.geom, p.geog) AS distance,
        l.updated_at
      ${nearbyFilterSql(6, 7)}
    ), paged AS MATERIALIZED (
    SELECT
      user_id,
      geom,
      distance,
      updated_at,
      (1.0 / (distance + 1)
        + (EXTRACT(EPOCH FROM updated_at) * 1000) / 1e10) AS score,
      COUNT(*) OVER() AS total_count
    FROM candidates
    ORDER BY score DESC, user_id ASC
    OFFSET $4
    LIMIT $5
    )
    SELECT user_id, ST_Y(geom::geometry) AS lat,
      ST_X(geom::geometry) AS lng, distance, updated_at, total_count
    FROM paged
    ORDER BY score DESC, user_id ASC
  `;

  return { query: pageQuery, values };
};

interface NearbyRow extends QueryResultRow {
  user_id: string;
  lat: number | string;
  lng: number | string;
  distance: number | string;
  updated_at: Date;
  total_count: string;
}

/** Owns spatial persistence; construction never opens a database connection. */
export class LocationRepository {
  constructor(private readonly pool: Pick<Pool, "query">, private readonly ttlDays: number) {}

  /**
   * Creates or updates a user's location.
   * geography(Point,4326) columns take (lng, lat) order, matching GeoJSON.
   */
  async upsertLocation(
    userId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    await this.pool.query(
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
  }

  async findNearby(
    lat: number,
    lng: number,
    maxDistance: number,
    skip: number,
    limit: number,
    excludeUserId?: string,
  ): Promise<FindNearbyResult> {
    const { query, values } = buildNearbyQuery(this.ttlDays, lat, lng, maxDistance, skip, limit, excludeUserId);
    const { rows } = await this.pool.query<NearbyRow>(query, values);

    // COUNT(*) OVER() is only present when the requested page has at least one
    // row. If OFFSET is beyond the final page, run a cheap count fallback so the
    // API still reports the real totalCount instead of zero.
    let totalCount = rows[0]?.total_count ? Number(rows[0].total_count) : 0;

    if (rows.length === 0 && skip > 0) {
      const countQuery = `
        WITH params AS (
          SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog
        )
        SELECT COUNT(*) AS total_count
        ${nearbyFilterSql(4, 5)}
      `;

      const countResult = await this.pool.query<{ total_count: string }>(countQuery, [
        lng, lat, maxDistance, this.ttlDays, excludeUserId ?? null,
      ]);
      totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    }

    const data: NearbyLocation[] = rows.map((row) => ({
      userId: row.user_id,
      coordinate: { lat: Number(row.lat), lng: Number(row.lng) },
      distance: Number(row.distance),
      updatedAt: row.updated_at,
    }));

    return { data, totalCount };
  }

  /** Physically delete expired rows using the same TTL as nearby searches. */
  async deleteStaleLocations(batchSize: number): Promise<number> {
    const { rowCount } = await this.pool.query(
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
      [this.ttlDays, batchSize],
    );
    return rowCount ?? 0;
  }
}
