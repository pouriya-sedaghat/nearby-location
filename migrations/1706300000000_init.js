/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension("postgis", { ifNotExists: true });

  pgm.createTable("locations", {
    id: "id",
    user_id: {
      type: "text",
      notNull: true,
      unique: true,
    },
    // geography(Point,4326) stores lng/lat and lets PostGIS return
    // distances directly in meters without manual projection math.
    geom: {
      type: "geography(Point,4326)",
      notNull: true,
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // GiST index required for ST_DWithin / KNN distance operators to be fast.
  pgm.createIndex("locations", "geom", {
    method: "gist",
    name: "locations_geom_gist_idx",
  });

  // Supports the nightly stale-location cleanup job (TTL replacement).
  pgm.createIndex("locations", "updated_at", {
    name: "locations_updated_at_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("locations");
  pgm.dropExtension("postgis", { ifExists: true });
};
