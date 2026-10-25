const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
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
  process.env.RANKING_MODE = "decay";
  process.env.RANKING_DISTANCE_SCALE_METERS = "2000";
  process.env.RANKING_FRESHNESS_HALF_LIFE_MINUTES = "60";
  process.env.RANKING_DISTANCE_WEIGHT = "0.65";
  process.env.RANKING_FRESHNESS_WEIGHT = "0.35";
  // HTTP-level checks below run the real app against this database.
  process.env.LOG_LEVEL = "error";
  process.env.PRIVACY_API_ENABLED = "true";
  process.env.PRIVACY_AUTH_TOKEN = "integration-privacy-token-32-characters";
  process.env.CURSOR_SIGNING_SECRET = "integration-cursor-secret-32-characters";
  process.env.CURSOR_REQUIRE_SIGNATURE = "true";

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

  const dbModule = require("../dist/utils/db");
  const { pool } = dbModule;
  const db = dbModule.default;
  const Location = require("../dist/models/location.model").default;

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

  test("privacy hard delete removes the live location and is idempotent", async () => {
    await Location.upsertLocation("erase_me", center.lat, center.lng);

    assert.equal(await Location.deleteUserLocation("erase_me"), true);
    assert.equal(await Location.deleteUserLocation("erase_me"), false);

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM locations WHERE user_id = $1",
      ["erase_me"],
    );
    assert.equal(rows[0].count, 0);
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
  test("cursor pagination returns each row once without OFFSET", async () => {
    await Location.upsertLocation("near_1", center.lat + 0.001, center.lng);
    await Location.upsertLocation("near_2", center.lat + 0.002, center.lng);
    await Location.upsertLocation("near_3", center.lat + 0.003, center.lng);

    // Equalize freshness so this fixture is ordered only by proximity.
    await pool.query(
      "UPDATE locations SET updated_at = date_trunc('second', now())",
    );

    const first = await Location.findNearbyByCursor(
      center.lat,
      center.lng,
      5_000,
      2,
    );

    assert.equal(first.totalCount, 3);
    assert.equal(first.data.length, 2);
    assert.equal(first.hasMore, true);
    assert.ok(first.rankingReferenceTime instanceof Date);

    const last = first.data[first.data.length - 1];
    const second = await Location.findNearbyByCursor(
      center.lat,
      center.lng,
      5_000,
      2,
      last.score,
      last.userId,
      undefined,
      first.rankingReferenceTime,
      first.totalCount,
    );

    assert.equal(second.totalCount, 3);
    assert.equal(second.data.length, 1);
    assert.equal(second.hasMore, false);

    const ids = [...first.data, ...second.data].map((row) => row.userId);
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(ids, ["near_1", "near_2", "near_3"]);
    assert.deepEqual(
      [...first.data, ...second.data].map((row) => row.coordinate),
      [0.001, 0.002, 0.003].map((delta) => ({ lat: center.lat + delta, lng: center.lng })),
    );
  });

  test("both pagination modes return stored negative/zero coordinates in lat/lng order", async () => {
    await Location.upsertLocation("southern", -33.865143, 151.2099);
    await Location.upsertLocation("equator", 0, -78.4678);
    for (const coordinate of [{ lat: -33.865143, lng: 151.2099 }, { lat: 0, lng: -78.4678 }]) {
      for (const result of [
        await Location.findNearby(coordinate.lat, coordinate.lng, 1000, 0, 10),
        await Location.findNearbyByCursor(coordinate.lat, coordinate.lng, 1000, 10),
      ]) {
        assert.equal(result.data.length, 1);
        assert.deepEqual(result.data[0].coordinate, coordinate);
        assert.equal(result.data[0].distance, 0);
      }
    }
  });

  test("decay cursor reference survives Date serialization without skipping tied rows", async () => {
    await pool.query(`
      INSERT INTO locations (user_id, geom, updated_at)
      SELECT 'tie_' || i, ST_SetSRID(ST_MakePoint($1, $2),4326)::geography,
        now() - interval '1 hour'
      FROM generate_series(1,7) AS i
    `, [center.lng, center.lat]);
    const first = await Location.findNearbyByCursor(center.lat, center.lng, 1000, 2);
    const replay = await Location.findNearbyByCursor(center.lat, center.lng, 1000, 2,
      undefined, undefined, undefined, first.rankingReferenceTime);
    assert.equal(replay.data[0].score, first.data[0].score, 'First-page SQL and cursor must use the exact same reference');
    const ids = first.data.map((row) => row.userId);
    let page = first;
    while (page.hasMore) {
      const last = page.data.at(-1);
      page = await Location.findNearbyByCursor(center.lat, center.lng, 1000, 2,
        last.score, last.userId, undefined, first.rankingReferenceTime, first.totalCount);
      ids.push(...page.data.map((row) => row.userId));
      assert.ok(ids.length <= 7, 'Cursor must advance without duplicates');
    }
    assert.deepEqual(ids, Array.from({length:7}, (_,i) => `tie_${i+1}`));
  });

  test("signed cursors traverse identifiers stored before control characters were rejected", async () => {
    const { buildNearbyQueryHash, decodeNearbyCursor, encodeNearbyCursor } = require("../dist/utils/cursor");
    const security = { signingSecret: "integration-cursor-secret-32-characters", requireSignature: true };
    // Rows written by versions before 2.13.1 (C0/C1 controls other than NUL).
    const ids = ["legacy\u0001a", "legacy\u0085b", "tab\tc", "plain_d"];
    await pool.query(`
      INSERT INTO locations (user_id, geom, updated_at)
      SELECT id, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, date_trunc('second', now())
      FROM unnest($3::text[]) AS id
    `, [center.lng, center.lat, ids]);
    const queryHash = buildNearbyQueryHash({ ...center, maxDistance: 1000 }, "0123456789abcdef");
    const seen = [];
    let page = await Location.findNearbyByCursor(center.lat, center.lng, 1000, 1);
    seen.push(...page.data.map((row) => row.userId));
    while (page.hasMore) {
      const last = page.data.at(-1);
      const cursor = decodeNearbyCursor(encodeNearbyCursor(last.score, last.userId, queryHash, {
        totalCount: page.totalCount,
        rankingContext: { rankedAtMs: page.rankingReferenceTime.getTime(), rankingProfileId: "0123456789abcdef" },
        security,
      }), security);
      page = await Location.findNearbyByCursor(center.lat, center.lng, 1000, 1,
        cursor.score, cursor.userId, undefined, new Date(cursor.rankedAtMs), cursor.totalCount);
      seen.push(...page.data.map((row) => row.userId));
      assert.ok(seen.length <= ids.length, "cursor must advance without duplicates");
    }
    assert.deepEqual([...seen].sort(), [...ids].sort());
    assert.equal(await Location.deleteUserLocation("legacy\u0001a"), true);
  });

  const withHttp = async (run) => {
    const app = require("../dist/app").default;
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const post = (path, body, token) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    try {
      await run(post);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
  const storedIds = async () =>
    // Sort in JavaScript: ORDER BY follows the database collation.
    (await pool.query("SELECT user_id FROM locations")).rows.map((row) => row.user_id).sort();

  const seedIds = async (ids) => {
    await pool.query("TRUNCATE TABLE locations RESTART IDENTITY");
    await pool.query(`
      INSERT INTO locations (user_id, geom)
      SELECT id, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography FROM unnest($3::text[]) AS id
    `, [center.lng, center.lat, ids]);
  };

  test("privacy erasure deletes exactly one identity: normalized endpoint or exact endpoint", async () => {
    // "\tuser" and " padded" model rows stored under older identifier rules.
    const ids = ["\tuser", "user", " padded", "padded"];
    await seedIds(ids);
    await withHttp(async (post) => {
      const erase = (body) => post("/privacy/location/delete", body, process.env.PRIVACY_AUTH_TOKEN);
      const eraseExact = (body) => post("/privacy/location/delete-exact", body, process.env.PRIVACY_AUTH_TOKEN);
      // The normalized endpoint rejects the control character instead of
      // trimming it into "user"; neither identity is touched.
      assert.equal((await erase({ userId: "\tuser" })).status, 400);
      assert.deepEqual(await storedIds(), [...ids].sort());
      assert.equal((await eraseExact({ userId: "\tuser" })).status, 204);
      assert.deepEqual(await storedIds(), [" padded", "padded", "user"]);
      // The normalized endpoint addresses the identity upsert(" padded") writes.
      assert.equal((await erase({ userId: " padded" })).status, 204);
      assert.deepEqual(await storedIds(), [" padded", "user"]);
      assert.equal((await eraseExact({ userId: " padded" })).status, 204);
      assert.deepEqual(await storedIds(), ["user"]);
      // Idempotent and non-enumerating on both endpoints.
      assert.equal((await eraseExact({ userId: "\tuser" })).status, 204);
      assert.deepEqual(await storedIds(), ["user"]);
    });
  });

  // A captured legacy privacy contract exercises rolling-upgrade safety even
  // from a source ZIP. This is a compatibility fixture, not an old full build.
  const startBaseVersion = async (t) => {
    const { createLegacyPrivacyApp } = require("./fixtures/legacy-privacy-contract");
    const app = createLegacyPrivacyApp(pool, process.env.PRIVACY_AUTH_TOKEN);
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return (route, body) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PRIVACY_AUTH_TOKEN}` },
      body: JSON.stringify(body),
    });
  };

  test("exact erasure fails closed against the captured legacy contract and deletes only the intended row here", { timeout: 120_000 }, async (t) => {
    const baseVersion = await startBaseVersion(t);
    await withHttp(async (post) => {
      const current = (route, body) => post(route, body, process.env.PRIVACY_AUTH_TOKEN);
      const exact = ["/privacy/location/delete-exact", { userId: " padded" }];

      // Released version: the exact endpoint does not exist (404), so a
      // rolling deployment cannot apply exact erasure as normalized erasure.
      await seedIds([" padded", "padded"]);
      assert.equal((await baseVersion(...exact)).status, 404);
      assert.deepEqual(await storedIds(), [" padded", "padded"]);
      // This version deletes exactly the stored identifier and nothing else.
      assert.equal((await current(...exact)).status, 204);
      assert.deepEqual(await storedIds(), ["padded"]);

      // A body selector on the shared path is unsafe: the released version
      // strips it and deletes the normalized identity, so this version
      // refuses such a request instead of interpreting it differently.
      const selector = ["/privacy/location/delete", { userId: " padded", match: "exact" }];
      await seedIds([" padded", "padded"]);
      assert.equal((await current(...selector)).status, 400);
      assert.deepEqual(await storedIds(), [" padded", "padded"]);
      assert.equal((await baseVersion(...selector)).status, 204);
      assert.deepEqual(await storedIds(), [" padded"]);

      // The normalized contract is identical across versions.
      for (const erase of [baseVersion, current]) {
        await seedIds([" padded", "padded"]);
        assert.equal((await erase("/privacy/location/delete", { userId: " padded" })).status, 204);
        assert.deepEqual(await storedIds(), [" padded"]);
      }
    });
  });

  test("worst-case escaped stored identifiers continue through signed cursors", async () => {
    const { MAX_CURSOR_LENGTH } = require("../dist/utils/cursor");
    const worst = ["legacy" + "\u0001".repeat(249), "\u0001".repeat(255)];
    await pool.query(`
      INSERT INTO locations (user_id, geom, updated_at)
      SELECT id, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, date_trunc('second', now())
      FROM unnest($3::text[]) AS id
      UNION ALL
      SELECT 'plain_after', ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, date_trunc('second', now())
    `, [center.lng, center.lat, worst]);
    await withHttp(async (post) => {
      for (const pagination of ["offset", "cursor"]) {
        const query = { coordinate: center, maxDistance: 1000, pageSize: 1, pagination };
        let page = await (await post("/location/nearby", query)).json();
        const seen = page.data.map((item) => item.userId);
        while (page.hasMore) {
          assert.ok(page.nextCursor.length <= MAX_CURSOR_LENGTH);
          const response = await post("/location/nearby", { ...query, pagination: undefined, cursor: page.nextCursor });
          assert.equal(response.status, 200, await response.clone().text());
          page = await response.json();
          seen.push(...page.data.map((item) => item.userId));
          assert.ok(seen.length <= 3, "cursor must advance without duplicates");
        }
        assert.deepEqual([...seen].sort(), [...worst, "plain_after"].sort(), pagination);
      }
    });
  });

  test("decay ranking balances proximity with location freshness", async () => {
    await Location.upsertLocation("stale_near", center.lat + 0.0045, center.lng);
    await Location.upsertLocation("fresh_far", center.lat + 0.018, center.lng);

    await pool.query(
      "UPDATE locations SET updated_at = now() - interval '4 hours' WHERE user_id = $1",
      ["stale_near"],
    );

    const result = await Location.findNearby(
      center.lat,
      center.lng,
      5_000,
      0,
      10,
    );

    assert.equal(result.totalCount, 2);
    assert.ok(result.rankingReferenceTime instanceof Date);
    assert.equal(result.data[0].userId, "fresh_far");
    assert.ok(result.data[0].score > result.data[1].score);
    assert.ok(result.data.every((row) => row.score > 0 && row.score <= 1));
  });

  test("PostgreSQL advisory lock prevents concurrent maintenance owners", async () => {
    let releaseFirst;
    let markEntered;
    const firstEntered = new Promise((resolve) => {
      markEntered = resolve;
    });
    const releaseGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = db.withAdvisoryLock(1_314_089_057, 99, async () => {
      markEntered();
      await releaseGate;
      return "first";
    });

    await firstEntered;

    const second = await db.withAdvisoryLock(
      1_314_089_057,
      99,
      async () => "second",
    );
    assert.equal(second.acquired, false);

    releaseFirst();
    const firstResult = await first;
    assert.equal(firstResult.acquired, true);
    assert.equal(firstResult.value, "first");
  });

  for (const mode of ["legacy", "decay"]) {
    test(`${mode} optimized queries preserve historical results and avoid repeated spatial projection`, async () => {
      await pool.query(`
        INSERT INTO locations (user_id, geom, updated_at)
        SELECT 'fixture_' || i,
          ST_Project(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            CASE WHEN i <= 4 THEN 0 ELSE i * 50 END, i * 0.1),
          date_trunc('second', now()) - make_interval(mins => (i / 5)::int)
        FROM generate_series(1, 100) AS i
        UNION ALL
        SELECT 'expired', ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, now() - interval '8 days'
        UNION ALL
        SELECT 'future', ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, now() + interval '1 day'
        UNION ALL
        SELECT 'far', ST_Project(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 20000, 0), now()
      `, [center.lng, center.lat]);
      const result = spawnSync(process.execPath, ["tests/fixtures/check-nearby-equivalence.js"], {
        encoding: "utf8", timeout: 60_000,
        env: { ...process.env, RANKING_MODE: mode, PG_POOL_MAX: "1" },
      });
      assert.equal(result.status, 0, result.stderr);
    });
  }

}
