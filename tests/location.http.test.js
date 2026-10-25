const assert = require("node:assert/strict");
const test = require("node:test");
const { createTestApp } = require("./fixtures/app.factory");
const { app, locations: Location, config } = createTestApp({
  SWAGGER_ENABLED: "true", SWAGGER_TRY_IT_OUT_ENABLED: "false",
  SWAGGER_AUTH_USERNAME: "test_docs", SWAGGER_AUTH_PASSWORD: "test-only-password-01234567890123456789",
  DEFAULT_MAX_DISTANCE_METERS: "1234", MAX_MAX_DISTANCE_METERS: "5678",
});
let server, url, calls;
const original = { ...Location };
const headers = { Authorization: `Basic ${Buffer.from(`${config.SWAGGER_AUTH_USERNAME}:${config.SWAGGER_AUTH_PASSWORD}`).toString("base64")}` };
test.before(async () => {
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  url = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  calls = [];
  Location.findNearby = async (...args) => {
    calls.push(args);
    return { totalCount: 1, data: [{ userId: "matched", coordinate: { lat: -33.9, lng: 151.2 }, distance: 12.5, updatedAt: new Date("2026-10-14T00:00:00Z") }] };
  };
  Location.upsertLocation = async (...args) => calls.push(args);
});
test.after(async () => {
  Object.assign(Location, original);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
const post = (body, query = "") => fetch(`${url}/location/nearby${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
test("nearby returns the matched user's stored coordinate and preserves metadata", async () => {
  const response = await post({ coordinate: { lat: 1, lng: 2 } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["success", "page", "pageSize", "totalCount", "totalPages", "hasMore", "data"].sort());
  assert.deepEqual(body.data[0].coordinate, { lat: -33.9, lng: 151.2 });
  assert.equal(body.data[0].distance, 12.5);
  assert.equal(body.totalCount, 1);
  assert.deepEqual(calls[0], [1, 2, 1234, 0, 10, undefined]);
});
test("body radius takes precedence over query and the maximum is inclusive", async () => {
  assert.equal((await post({ coordinate: { lat: 0, lng: 0 }, maxDistance: 5678 }, "?maxDistance=100&page=2&pageSize=5")).status, 200);
  assert.deepEqual(calls[0], [0, 0, 5678, 5, 5, undefined]);
  assert.equal((await post({ coordinate: { lat: 0, lng: 0 } }, "?maxDistance=500")).status, 200);
  assert.equal(calls[1][2], 500);
});
test("invalid radii are rejected before a database operation", async () => {
  for (const maxDistance of [0, -1, 5679, true, false, null, [], [100], {}, "", " ", "NaN"]) {
    assert.equal((await post({ coordinate: { lat: 0, lng: 0 }, maxDistance })).status, 400, JSON.stringify(maxDistance));
  }
  assert.equal(calls.length, 0);
});
test("unsafe offset is rejected before database access", async () => {
  assert.equal((await post({ coordinate: { lat: 0, lng: 0 }, page: Number.MAX_SAFE_INTEGER, pageSize: 100 })).status, 400);
  assert.equal(calls.length, 0);
});
test("upsert still passes latitude and longitude without swapping them", async () => {
  const response = await fetch(`${url}/location/upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: " example ", coordinate: { lat: -33.9, lng: 151.2 } }) });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], ["example", -33.9, 151.2]);
});
test("Basic Auth guards Swagger HTML, assets and live OpenAPI", async () => {
  for (const endpoint of ["/api-docs/", "/api-docs/openapi.json", "/api-docs/swagger-ui.css", "/api-docs/swagger-ui-init.js"]) {
    const rejected = await fetch(url + endpoint);
    assert.equal(rejected.status, 401, endpoint);
    assert.match(rejected.headers.get("www-authenticate"), /^Basic /);
    assert.equal((await fetch(url + endpoint, { headers })).status, 200, endpoint);
  }
  const spec = await (await fetch(`${url}/api-docs/openapi.json`, { headers })).json();
  assert.equal(spec.info.version, require("../package.json").version);
  const radius = spec.paths["/location/nearby"].post.parameters.find((p) => p.name === "maxDistance").schema;
  assert.equal(radius.default, 1234);
  assert.equal(radius.maximum, 5678);
  const bodyRadius = spec.components.schemas.NearbyRequest.properties.maxDistance;
  for (const key of ["default", "maximum", "minimum", "exclusiveMinimum", "type"]) {
    assert.equal(radius[key], bodyRadius[key], key);
  }
});
test("Try it out stays disabled in the configured production-style UI", async () => {
  const script = await (await fetch(`${url}/api-docs/swagger-ui-init.js`, { headers })).text();
  assert.match(script, /"supportedSubmitMethods": \[\]/);
  assert.match(script, /"persistAuthorization": false/);
  assert.equal((await fetch(`${url}/health/live`)).status, 200);
});

test("malformed JSON returns 400 without reaching the model", async () => {
  for (const endpoint of ["/location/upsert", "/location/nearby"]) {
    const response = await fetch(url + endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: '{"coordinate":',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, message: "Invalid JSON body" });
  }
  assert.equal(calls.length, 0);
});

test("oversized JSON returns 413 without reaching the model", async () => {
  const response = await post({ coordinate: { lat: 0, lng: 0 }, padding: "x".repeat(33 * 1024) });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { success: false, message: "Request body too large" });
  assert.equal(calls.length, 0);
});

test("unsupported JSON charset returns 415", async () => {
  const response = await fetch(`${url}/location/upsert`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=iso-8859-1" },
    body: JSON.stringify({ userId: "example", coordinate: { lat: 0, lng: 0 } }),
  });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { success: false, message: "Unsupported request body encoding" });
  assert.equal(calls.length, 0);
});

test("PostgreSQL-incompatible NUL user IDs return 400 before database access", async () => {
  const response = await fetch(`${url}/location/upsert`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "bad\u0000id", coordinate: { lat: 0, lng: 0 } }),
  });
  assert.equal(response.status, 400);
  assert.equal((await post({ coordinate: { lat: 0, lng: 0 }, excludeUserId: "bad\u0000id" })).status, 400);
  assert.equal(calls.length, 0);
});

test("malformed Unicode identifiers are rejected before UTF-8 replacement can alias users", async () => {
  for (const userId of ["user-" + String.fromCharCode(0xd800), "user-" + String.fromCharCode(0xdc00)]) {
    const response = await fetch(url + "/location/upsert", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, coordinate: { lat: 0, lng: 0 } }),
    });
    assert.equal(response.status, 400);
    assert.equal((await post({ coordinate: { lat: 0, lng: 0 }, excludeUserId: userId })).status, 400);
  }
  assert.equal(calls.length, 0);
});

test("valid non-ASCII and supplementary-plane identifiers are preserved", async () => {
  const userId = "user-" + String.fromCodePoint(0x1f680, 0x00e9);
  const response = await fetch(url + "/location/upsert", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, coordinate: { lat: 0, lng: 0 } }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0][0], userId);
});

test("valid compressed JSON is still accepted", async () => {
  const { gzipSync } = require("node:zlib");
  const response = await fetch(url + "/location/upsert", {
    method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: gzipSync(JSON.stringify({ userId: "compressed", coordinate: { lat: 0, lng: 0 } })),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], ["compressed", 0, 0]);
});

test("corrupt compressed JSON is a client error and never reaches the model", async () => {
  const response = await fetch(url + "/location/upsert", {
    method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: Buffer.from("not a gzip stream"),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, message: "Invalid JSON body" });
  assert.equal(calls.length, 0);
});

test("invalid UTF-8 bytes cannot alias identifiers through decoder replacement", async () => {
  for (const endpoint of ["/location/upsert", "/location/nearby"]) {
    const field = endpoint.endsWith("upsert") ? "userId" : "excludeUserId";
    for (const byte of [0xff, 0xfe]) {
      const body = Buffer.concat([Buffer.from(`{"${field}":"bad-`), Buffer.from([byte]),
        Buffer.from('","coordinate":{"lat":0,"lng":0}}')]);
      const response = await fetch(url + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { success: false, message: "Invalid JSON body" });
    }
  }
  assert.equal(calls.length, 0);
});

test("valid Unicode, UTF-8 BOM and supported UTF-16 transports remain accepted", async () => {
  const userId = "transport-" + String.fromCodePoint(0xfffd, 0x00d8, 0x1f680);
  const json = JSON.stringify({ userId, coordinate: { lat: 0, lng: 0 } });
  const utf16 = Buffer.from(json, "utf16le");
  for (const [charset, body] of [["utf-8", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json)])],
    ["utf-16le", utf16], ["utf-16be", Buffer.from(utf16).swap16()]]) {
    const response = await fetch(url + "/location/upsert", { method: "POST",
      headers: { "Content-Type": "application/json; charset=" + charset }, body });
    assert.equal(response.status, 200, charset);
    assert.deepEqual(calls.at(-1), [userId, 0, 0]);
  }
});

test("compressed malformed UTF-8 is rejected after decompression", async () => {
  const body = Buffer.concat([Buffer.from('{"userId":"bad-'), Buffer.from([0xff]),
    Buffer.from('","coordinate":{"lat":0,"lng":0}}')]);
  const response = await fetch(url + "/location/upsert", { method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: require("node:zlib").gzipSync(body) });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, message: "Invalid JSON body" });
  assert.equal(calls.length, 0);
});
