WITH params AS (
      SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog
    ), candidates AS (
      SELECT
        l.user_id,
        ST_Distance(l.geom, p.geog) AS distance,
        l.updated_at

  FROM locations l
  CROSS JOIN params p
  WHERE ST_DWithin(l.geom, p.geog, $3)
    AND l.updated_at >= now() - make_interval(days => $6::int)
    AND ($7::text IS NULL OR l.user_id <> $7)

    )
    SELECT
      user_id,
      distance,
      updated_at,
      COUNT(*) OVER() AS total_count
    FROM candidates
    ORDER BY (
      1.0 / (distance + 1)
      + (EXTRACT(EPOCH FROM updated_at) * 1000) / 1e10
    ) DESC,
    user_id ASC
    OFFSET $4
    LIMIT $5
