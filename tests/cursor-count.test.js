const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.RANKING_MODE = "legacy";

const fakePool = { query: async () => ({ rows: [] }) };

const injectModule = (resolvedPath, exports) => {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
};

// Keep this SQL-shape unit test independent from pg/dotenv/zod packages. The
// real driver and PostGIS behavior are covered by location.integration.test.js.
injectModule(require.resolve("../dist/utils/db"), {
  pool: fakePool,
  default: { pool: fakePool },
});
injectModule(require.resolve("../dist/config/env"), {
  config: { LOCATION_TTL_DAYS: 7 },
});
injectModule(require.resolve("../dist/config/ranking"), {
  rankingProfile: {
    mode: "legacy",
    distanceScaleMeters: 2000,
    freshnessHalfLifeMinutes: 60,
    distanceWeight: 0.65,
    freshnessWeight: 0.35,
    profileId: "0000000000000000",
  },
});

const Location = require("../dist/models/location.model").default;

const sampleRow = {
  user_id: "user_2",
  lat: 35.7,
  lng: 51.4,
  distance: 120,
  updated_at: new Date("2026-10-07T08:00:00Z"),
  ranked_at: new Date("2026-10-07T08:00:00Z"),
  score: 10,
  total_count: "42",
};

test("cursor pages reuse signed-cursor totalCount instead of recounting candidates", async () => {
  const originalQuery = fakePool.query;
  const calls = [];

  fakePool.query = async (sql, values) => {
    calls.push({ sql: String(sql), values });
    return { rows: [sampleRow], rowCount: 1 };
  };

  try {
    const result = await Location.findNearbyByCursor(
      35.6892,
      51.389,
      10000,
      10,
      11,
      "user_1",
      undefined,
      undefined,
      42,
    );

    assert.equal(result.totalCount, 42);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /\$14::bigint AS total_count/);
    assert.doesNotMatch(calls[0].sql, /SELECT COUNT\(\*\) FROM ranked/);
    assert.equal(calls[0].values.length, 14);
    assert.equal(calls[0].values[13], 42);
  } finally {
    fakePool.query = originalQuery;
  }
});

test("first cursor page computes totalCount once and emits it with the page", async () => {
  const originalQuery = fakePool.query;
  const calls = [];

  fakePool.query = async (sql, values) => {
    calls.push({ sql: String(sql), values });
    return { rows: [sampleRow], rowCount: 1 };
  };

  try {
    const result = await Location.findNearbyByCursor(
      35.6892,
      51.389,
      10000,
      10,
    );

    assert.equal(result.totalCount, 42);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /\(SELECT COUNT\(\*\) FROM ranked\) AS total_count/);
    assert.equal(calls[0].values.length, 13);
  } finally {
    fakePool.query = originalQuery;
  }
});
