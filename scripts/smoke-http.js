const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");

/** Synthetic VM checks. Never point this command at a live user database. */
const runSmoke = async ({ baseUrl, tokens, fetchImpl = fetch }) => {
  const checks = [];
  const fixtures = new Map([
    [`vm_smoke_${randomUUID()}_a`, { lat: 0, lng: 0 }],
    [`vm_smoke_${randomUUID()}_b`, { lat: 0.001, lng: 0 }],
    [`vm_smoke_${randomUUID()}_c`, { lat: 0, lng: 0.002 }],
  ]);
  const attempted = new Set();
  const center = { lat: 0, lng: 0 };
  const query = { coordinate: center, maxDistance: 1000, pageSize: 100 };
  const request = async (route, { surface = "location", body, headers = {}, raw } = {}) => {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method: body !== undefined || raw !== undefined ? "POST" : "GET",
      headers: {
        ...(surface ? { Authorization: `Bearer ${tokens[surface]}` } : {}),
        ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { /* Metrics/204 use non-JSON bodies. */ }
    return { status: response.status, headers: response.headers, text, data };
  };
  const expectStatus = (result, status) => assert.equal(result.status, status, `Expected HTTP ${status}, received ${result.status}`);
  const check = async (name, action) => {
    const started = performance.now();
    try {
      await action();
      checks.push({ name, passed: true, durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      checks.push({ name, passed: false, error: error.message });
      throw error;
    }
  };
  const nearby = (body) => request("/location/nearby", { body });
  const erase = (userId) => request("/privacy/location/delete", { surface: "privacy", body: { userId } });
  const eraseExact = (userId) => request("/privacy/location/delete-exact", { surface: "privacy", body: { userId } });
  const verifyItem = (item) => {
    assert.ok(fixtures.has(item.userId), "Expected a synthetic fixture in this isolated test area");
    const coordinate = fixtures.get(item.userId);
    assert.ok(item.coordinate, "Missing stored coordinate");
    assert.ok(Math.abs(item.coordinate.lat - coordinate.lat) < 1e-8, "Incorrect stored latitude");
    assert.ok(Math.abs(item.coordinate.lng - coordinate.lng) < 1e-8, "Incorrect stored longitude");
    assert.ok(Number.isFinite(item.distance) && item.distance >= 0, "Invalid distance");
    assert.ok(Number.isFinite(Date.parse(item.updatedAt)), "Invalid updatedAt timestamp");
    assert.match(item.updateStatus, /^(just now|\d+ .+ ago|in \d+ .+)$/);
    assert.equal("score" in item, false, "Internal ranking score leaked");
  };

  try {
    await check("configuration", () => {
      const target = new URL(baseUrl);
      assert.ok(["http:", "https:"].includes(target.protocol));
      assert.ok(!target.username && !target.password, "Use bearer credentials outside the URL");
      for (const key of ["location", "metrics", "privacy"]) assert.ok(tokens[key], `Missing ${key} credential`);
    });
    await check("health", async () => {
      expectStatus(await request("/health/live", { surface: null }), 200);
      expectStatus(await request("/health/ready", { surface: null }), 200);
    });
    await check("authentication_boundaries", async () => {
      expectStatus(await request("/location/nearby", { surface: null, body: query }), 401);
      expectStatus(await request("/metrics", { surface: null }), 401);
      expectStatus(await request("/privacy/location/delete", { surface: "location", body: { userId: "vm_smoke_nonexistent" } }), 401);
      expectStatus(await request("/privacy/location/delete-exact", { surface: "location", body: { userId: "vm_smoke_nonexistent" } }), 401);
    });
    await check("upsert", async () => {
      for (const [userId, coordinate] of fixtures) {
        attempted.add(userId);
        expectStatus(await request("/location/upsert", { body: { userId, coordinate } }), 200);
      }
    });
    await check("upsert_updates_existing_user", async () => {
      const userId = fixtures.keys().next().value;
      const coordinate = { lat: 0.003, lng: 0.001 };
      fixtures.set(userId, coordinate);
      expectStatus(await request("/location/upsert", { body: { userId, coordinate } }), 200);
    });
    await check("offset_coordinates_and_relative_time", async () => {
      const result = await nearby(query);
      expectStatus(result, 200);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(result.data.totalCount, 3, "Use an isolated synthetic test area/database");
      assert.equal(result.data.data.length, 3);
      result.data.data.forEach(verifyItem);
    });
    await check("exclusion", async () => {
      const userId = fixtures.keys().next().value;
      const result = await nearby({ ...query, excludeUserId: userId });
      expectStatus(result, 200);
      assert.equal(result.data.totalCount, 2);
      assert.ok(result.data.data.every((item) => item.userId !== userId));
    });
    await check("signed_cursor_traversal", async () => {
      const first = await nearby({ ...query, pagination: "cursor", pageSize: 1 });
      expectStatus(first, 200);
      assert.equal(first.data.hasMore, true);
      assert.match(first.data.nextCursor, /^s1\./);
      verifyItem(first.data.data[0]);
      const second = await nearby({ ...query, cursor: first.data.nextCursor, pageSize: 1 });
      expectStatus(second, 200);
      verifyItem(second.data.data[0]);
      assert.notEqual(first.data.data[0].userId, second.data.data[0].userId);
      assert.equal(second.data.totalCount, first.data.totalCount);
      const [prefix, payload, signature] = first.data.nextCursor.split(".");
      const invalid = `${prefix}.${payload}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
      expectStatus(await nearby({ ...query, cursor: invalid, pageSize: 1 }), 400);
    });
    await check("validation_and_body_errors", async () => {
      expectStatus(await nearby({ coordinate: { lat: 91, lng: 0 } }), 400);
      expectStatus(await nearby({ ...query, excludeUserId: "invalid\u0000id" }), 400);
      expectStatus(await request("/location/nearby", { raw: "{" }), 400);
      expectStatus(await request("/location/nearby", { raw: "{}", headers: { "Content-Encoding": "compress" } }), 415);
    });
    await check("empty_offset_page", async () => {
      const result = await nearby({ ...query, page: 1000 });
      expectStatus(result, 200);
      assert.deepEqual(result.data.data, []);
    });
    await check("privacy_erasure_is_idempotent", async () => {
      const userId = fixtures.keys().next().value;
      expectStatus(await erase(userId), 204);
      expectStatus(await erase(userId), 204);
      const result = await nearby(query);
      expectStatus(result, 200);
      assert.equal(result.data.totalCount, 2);
      assert.ok(result.data.data.every((item) => item.userId !== userId));
    });
    await check("exact_erasure_endpoint", async () => {
      const userId = [...fixtures.keys()][1];
      // Exact erasure never trims: a padded identifier is a different identity.
      expectStatus(await eraseExact(` ${userId}`), 204);
      let result = await nearby(query);
      expectStatus(result, 200);
      assert.ok(result.data.data.some((item) => item.userId === userId), "Exact erasure must not trim identifiers");
      expectStatus(await eraseExact(userId), 204);
      result = await nearby(query);
      expectStatus(result, 200);
      assert.equal(result.data.totalCount, 1);
      assert.ok(result.data.data.every((item) => item.userId !== userId));
    });
    await check("authenticated_metrics", async () => {
      const result = await request("/metrics", { surface: "metrics" });
      expectStatus(result, 200);
      assert.match(result.text, /nearby_http_requests_total/);
      assert.match(result.text, /nearby_pg_pool_total_connections/);
    });
  } catch { /* Failed check is recorded; cleanup still runs. */ }
  finally {
    if (attempted.size > 0) {
      try {
        await check("fixture_cleanup", async () => {
          for (const userId of attempted) expectStatus(await erase(userId), 204);
        });
      } catch { /* Cleanup failure also makes the run fail. */ }
    }
  }
  return { passed: checks.every((entry) => entry.passed), checks };
};

if (require.main === module) {
  runSmoke({
    baseUrl: (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, ""),
    tokens: {
      location: process.env.LOCATION_AUTH_TOKEN,
      metrics: process.env.METRICS_AUTH_TOKEN,
      privacy: process.env.PRIVACY_AUTH_TOKEN,
    },
  }).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 2;
  }).catch(() => { console.error("Smoke runner failed before producing a report"); process.exitCode = 1; });
}

module.exports = { runSmoke };
