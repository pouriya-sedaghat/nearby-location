const assert = require("node:assert/strict");
const test = require("node:test");
const { createHmac } = require("node:crypto");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.RANKING_MODE = "legacy";
process.env.LOCATION_AUTH_MODE = "bearer";
process.env.LOCATION_AUTH_TOKEN = "http-test-location-token-32-characters";
process.env.CURSOR_SIGNING_SECRET = "http-test-cursor-secret-32-characters";
process.env.CURSOR_REQUIRE_SIGNATURE = "true";
process.env.PRIVACY_API_ENABLED = "true";
process.env.PRIVACY_AUTH_TOKEN = "http-test-privacy-token-32-characters";

const { pool } = require("../dist/utils/db");
const app = require("../dist/app").default;
const { buildNearbyQueryHash, encodeNearbyCursor, MAX_CURSOR_LENGTH } = require("../dist/utils/cursor");
const center = { lat: 35.6892, lng: 51.389 };
let server;
let baseUrl;
let rows;
let failure;
let calls;
const originalQuery = pool.query;
const row = (userId, lat, lng, totalCount = 1) => ({
  user_id: userId,
  lat,
  lng,
  distance: 123.456,
  score: 10,
  updated_at: new Date(),
  ranked_at: new Date(),
  total_count: String(totalCount),
});

test.before(async () => {
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (failure) throw failure;
    return { rows, rowCount: rows.length };
  };
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.beforeEach(() => {
  rows = [row("near_1", -12.34, 0)];
  calls = [];
  failure = undefined;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  pool.query = originalQuery;
  await pool.end();
});

const nearby = (body, query = "") => fetch(`${baseUrl}/location/nearby${query}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LOCATION_AUTH_TOKEN}`,
  },
  body: JSON.stringify(body),
});

test("offset HTTP response exposes each stored coordinate and hides the ranking score", async () => {
  const response = await nearby({ coordinate: center });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.paginationMode, "offset");
  assert.deepEqual(body.data[0].coordinate, { lat: -12.34, lng: 0 });
  assert.equal(body.data[0].userId, "near_1");
  assert.equal(body.data[0].distance, 123.456);
  assert.equal(typeof body.data[0].updatedAt, "string");
  assert.equal(typeof body.data[0].updateStatus, "string");
  assert.equal("score" in body.data[0], false);
});

test("cursor HTTP traversal preserves coordinates on first and subsequent pages", async () => {
  rows = [row("near_1", 0, -45.6, 2), row("near_2", 1.2, 3.4, 2)];
  const first = await (await nearby({ coordinate: center, pagination: "cursor", pageSize: 1 })).json();
  assert.equal(first.paginationMode, "cursor");
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.data[0].coordinate, { lat: 0, lng: -45.6 });
  assert.ok(first.nextCursor.startsWith("s1."));

  rows = [row("near_2", 1.2, 3.4, 2)];
  const response = await nearby({ coordinate: center, cursor: first.nextCursor, pageSize: 1 });
  assert.equal(response.status, 200);
  const second = await response.json();
  assert.deepEqual(second.data[0].coordinate, { lat: 1.2, lng: 3.4 });
  assert.equal(second.totalCount, 2);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
});

test("a signed cursor with a maximum-length Unicode user id is accepted", async () => {
  const cursor = encodeNearbyCursor(10, "界".repeat(255), buildNearbyQueryHash({ ...center, maxDistance: 10000 }), {
    totalCount: 1,
    security: { signingSecret: process.env.CURSOR_SIGNING_SECRET },
  });
  assert.ok(cursor.length > 1024, "fixture must exercise the former request limit");
  assert.ok(cursor.length <= MAX_CURSOR_LENGTH);
  const response = await nearby({ coordinate: center }, `?${new URLSearchParams({ cursor })}`);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test("empty HTTP result remains an empty array in both pagination modes", async () => {
  rows = [];
  for (const pagination of ["offset", "cursor"]) {
    const response = await nearby({ coordinate: center, pagination });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, []);
    assert.equal(body.totalCount, 0);
    assert.equal(body.hasMore, false);
    assert.equal(body.nextCursor, null);
  }
});

test("invalid coordinates, unsafe offsets, and malformed cursors fail before DB access", async () => {
  for (const body of [
    { coordinate: { lat: 91, lng: 0 } },
    { coordinate: { lat: 0, lng: -181 } },
    { coordinate: { lat: "35", lng: 0 } },
    { coordinate: center, page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { coordinate: center, page: 1e308 },
    { coordinate: center, maxDistance: 100001 },
    { coordinate: center, cursor: "invalid" },
    { coordinate: center, pagination: "cursor", page: 1 },
    { coordinate: center, excludeUserId: "user\u0000id" },
    { coordinate: center, excludeUserId: "user\u0007id" },
  ]) {
    assert.equal((await nearby(body)).status, 400);
  }
  assert.equal(calls.length, 0);
});

test("location auth precedes parsing an invalid JSON body", async () => {
  const response = await fetch(`${baseUrl}/location/nearby`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("numeric HTTP fields reject JSON booleans, arrays, objects and null", async () => {
  for (const key of ['maxDistance', 'page', 'pageSize']) {
    for (const value of [true, false, [1], { value: 1 }, null, '']) {
      assert.equal((await nearby({ coordinate: center, [key]: value })).status, 400, `${key}: ${JSON.stringify(value)}`);
    }
  }
  assert.equal(calls.length, 0);
});

test("numeric query strings and body numbers retain their documented behavior", async () => {
  const response = await nearby({ coordinate: center }, '?maxDistance=5000&page=2&pageSize=5');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.page, 2);
  assert.equal(body.pageSize, 5);
  assert.equal(calls[0].values[2], 5000);
  assert.equal(calls[0].values[3], 5);
});

test("retryable database failures produce 503 and Retry-After", async () => {
  for (const error of [
    Object.assign(new Error("connection lost"), { code: "08006" }),
    Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    new Error("timeout exceeded when trying to connect"),
  ]) {
    failure = error;
    const response = await nearby({ coordinate: center });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "1");
    assert.deepEqual(await response.json(), { success: false, message: "Service temporarily unavailable" });
  }
});

test("upsert rejects PostgreSQL-incompatible identifiers before accessing storage", async () => {
  for (const userId of ["user\u0000id", "user\u007fid"]) {
    const response = await fetch(`${baseUrl}/location/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LOCATION_AUTH_TOKEN}` },
      body: JSON.stringify({ userId, coordinate: center }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("a correctly signed cursor cannot bypass user ID validation", async () => {
  const payload = Buffer.from(JSON.stringify({
    version: 3, score: 10, userId: "user\u0000id",
    queryHash: buildNearbyQueryHash({ ...center, maxDistance: 10000 }),
    totalCount: 1, issuedAtMs: Date.now(),
  })).toString("base64url");
  const signature = createHmac("sha256", process.env.CURSOR_SIGNING_SECRET).update(payload).digest("base64url");
  const res = await nearby({ coordinate: center, cursor: `s1.${payload}.${signature}` });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("invalid JSON, unsupported charset/encoding, and corrupt gzip remain client errors", async () => {
  for (const [headers, body, status, message] of [
    [{}, "{", 400, "Invalid JSON body"],
    [{ "Content-Type": "application/json; charset=iso-8859-1" }, "{}", 415, "Unsupported request encoding or charset"],
    [{ "Content-Encoding": "compress" }, "{}", 415, "Unsupported request encoding or charset"],
    [{ "Content-Encoding": "gzip" }, Buffer.from("not gzip"), 400, "Invalid request body"],
    [{}, JSON.stringify({ padding: "x".repeat(33000) }), 413, "Request body too large"],
  ]) {
    const res = await fetch(`${baseUrl}/location/nearby`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LOCATION_AUTH_TOKEN}`, ...headers },
      body,
    });
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), { success: false, message });
  }
  assert.equal(calls.length, 0);
});

test("ill-formed Unicode identifiers are rejected before PostgreSQL can merge them", async () => {
  // JSON escapes keep the lone surrogate intact until validation; UTF-8
  // encoding would otherwise store it as U+FFFD and collide with other IDs.
  for (const userId of ["victim\ud800", "\udc00victim"]) {
    const upsert = await fetch(`${baseUrl}/location/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LOCATION_AUTH_TOKEN}` },
      body: JSON.stringify({ userId, coordinate: center }),
    });
    assert.equal(upsert.status, 400);
    assert.equal((await nearby({ coordinate: center, excludeUserId: userId })).status, 400);
  }
  assert.equal((await nearby({ coordinate: center, excludeUserId: "😀user" })).status, 200);
  assert.equal(calls.length, 1);
});

test("a page ending on an identifier stored before 2.13.1 still returns a usable cursor", async () => {
  const legacyUserId = "legacy\u0001id";
  for (const pagination of ["offset", "cursor"]) {
    // Offset SQL applies LIMIT; cursor SQL fetches one extra row to set hasMore.
    rows = pagination === "offset"
      ? [row(legacyUserId, 1, 2, 2)]
      : [row(legacyUserId, 1, 2, 2), row("near_2", 1.2, 3.4, 2)];
    const response = await nearby({ coordinate: center, pagination, pageSize: 1 });
    assert.equal(response.status, 200, pagination);
    const first = await response.json();
    assert.equal(first.data[0].userId, legacyUserId);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor.startsWith("s1."));

    rows = [row("near_2", 1.2, 3.4, 2)];
    calls = [];
    const next = await nearby({ coordinate: center, cursor: first.nextCursor, pageSize: 1 });
    assert.equal(next.status, 200, pagination);
    assert.equal(calls[0].values[4], legacyUserId, "keyset continues after the stored identifier");
  }
});

test("a page ending on the longest escaped stored identifier continues via body and query string", async () => {
  // 249 control characters become 1,500 JSON bytes; the former 2,048-character
  // limit rejected the continuation of a cursor the service had just issued.
  const worstUserId = "legacy" + "\u0001".repeat(249);
  for (const pagination of ["offset", "cursor"]) {
    rows = pagination === "offset"
      ? [row(worstUserId, 1, 2, 2)]
      : [row(worstUserId, 1, 2, 2), row("near_2", 1.2, 3.4, 2)];
    const first = await (await nearby({ coordinate: center, pagination, pageSize: 1 })).json();
    assert.equal(first.data[0].userId, worstUserId);
    assert.ok(first.nextCursor.length > 2048, `fixture must exceed the former limit (${first.nextCursor.length})`);
    assert.ok(first.nextCursor.length <= MAX_CURSOR_LENGTH);
    for (const viaQuery of [false, true]) {
      rows = [row("near_2", 1.2, 3.4, 2)];
      calls = [];
      const next = viaQuery
        ? await nearby({ coordinate: center, pageSize: 1 }, `?${new URLSearchParams({ cursor: first.nextCursor })}`)
        : await nearby({ coordinate: center, cursor: first.nextCursor, pageSize: 1 });
      assert.equal(next.status, 200, `${pagination} via ${viaQuery ? "query" : "body"}: ${await next.clone().text()}`);
      assert.equal(calls[0].values[4], worstUserId);
    }
  }
});

const erase = (body, route = "/privacy/location/delete") => fetch(`${baseUrl}${route}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PRIVACY_AUTH_TOKEN}` },
  body: JSON.stringify(body),
});
const eraseExact = (body) => erase(body, "/privacy/location/delete-exact");

test("normalized erasure keeps the 2.13.5 contract and never rewrites a rejected identity", async () => {
  rows = [];
  // Control characters (including a tab that trimming would remove), NUL and
  // ill-formed Unicode are rejected exactly as by upsert; nothing is deleted.
  for (const userId of ["\tuser", "user\t", "legacy\u0001id", "user\u0000id", "user\ud800id", " "]) {
    assert.equal((await erase({ userId })).status, 400, JSON.stringify(userId));
  }
  assert.equal(calls.length, 0);
  // Same normalization as upsert: " user " was stored as "user".
  assert.equal((await erase({ userId: " user " })).status, 204);
  assert.deepEqual(calls.map((call) => call.values), [["user"]]);
});

test("normalized erasure rejects any selector field instead of silently ignoring it", async () => {
  // Releases up to 2.13.5 strip unknown fields, so a selector such as match
  // would be ignored there. This version refuses it rather than guessing.
  rows = [];
  for (const match of ["exact", "normalized", null, true]) {
    const response = await erase({ userId: " padded", match });
    assert.equal(response.status, 400, JSON.stringify(match));
    assert.match(JSON.stringify(await response.json()), /delete-exact/);
  }
  assert.equal(calls.length, 0);
});

test("exact erasure endpoint deletes the stored identifier byte-for-byte", async () => {
  rows = [];
  for (const userId of ["user\u0000id", "user\ud800id", "   ", "", "x".repeat(256)]) {
    assert.equal((await eraseExact({ userId })).status, 400, JSON.stringify(userId));
  }
  for (const body of [{}, { userId: " padded", match: "exact" }, { userId: " padded", extra: 1 }, ["user"]]) {
    assert.equal((await eraseExact(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  const stored = ["\tuser", " user ", " padded", "legacy\u0001id", "\u0001".repeat(255)];
  for (const userId of stored) assert.equal((await eraseExact({ userId })).status, 204);
  assert.deepEqual(calls.map((call) => call.values), stored.map((userId) => [userId]));
});

test("exact erasure requires the privacy token and reports its own route in metrics", async () => {
  const unauthorized = await fetch(`${baseUrl}/privacy/location/delete-exact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LOCATION_AUTH_TOKEN}` },
    body: JSON.stringify({ userId: "user" }),
  });
  assert.equal(unauthorized.status, 401);
  const { metrics } = require("../dist/utils/metrics");
  assert.match(metrics.renderPrometheus(), /route="\/privacy\/location\/delete-exact",status="401"/);
});
