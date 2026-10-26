const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { createTestApp } = require("./fixtures/app.factory");
const { parseConfig } = require("../dist/config/env");
const { withPostgresOptions } = require("../scripts/lib/postgres-options");

const password = "review-fixture-documentation-password-0123456789";
const authorization = "Basic " + Buffer.from("docs:" + password).toString("base64");
let server, base, database, calls;
test.before(async () => {
  const service = createTestApp({ SWAGGER_ENABLED: "true", SWAGGER_AUTH_USERNAME: "docs",
    SWAGGER_AUTH_PASSWORD: password, ADMISSION_ENABLED: "false" });
  ({ database } = service);
  calls = [];
  service.locations.upsertLocation = async (...values) => { calls.push(values); };
  server = service.app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await database.disconnect();
});

test("canonical Swagger UI, specification, HEAD and local assets live under /api/docs", async () => {
  for (const route of ["/api/docs/", "/api/docs/openapi.json", "/api/docs/swagger-ui-init.js", "/api/docs/swagger-ui.css"]) {
    const response = await fetch(base + route, { headers: { Authorization: authorization } });
    assert.equal(response.status, 200, route);
    await response.arrayBuffer();
  }
  const response = await fetch(base + "/api/docs/", { method: "HEAD", headers: { Authorization: authorization } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("documentation auth precedes malformed, oversized and unsupported JSON transports", async () => {
  for (const [contentType, body] of [["application/json", "{"], ["application/json", "x".repeat(33000)],
    ["application/json; charset=utf-7", "{}"]]) {
    const response = await fetch(base + "/api/docs/openapi.json", {
      method: "POST", headers: { "Content-Type": contentType }, body,
    });
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
});

test("unknown docs resources and unsupported methods return English JSON 404, never HTML 200", async () => {
  for (const [method, route] of [["GET", "/api/docs/missing.js"], ["POST", "/api/docs/"],
    ["PUT", "/api/docs/openapi.json"], ["OPTIONS", "/api/docs/"]]) {
    const response = await fetch(base + route, { method,
      headers: { Authorization: authorization, "Accept-Language": "fa", "Content-Type": "application/json" },
      ...(method === "POST" || method === "PUT" ? { body: "{" } : {}),
    });
    assert.equal(response.status, 404, method + " " + route);
    assert.equal(response.headers.get("content-language"), "en");
    assert.deepEqual(await response.json(), { success: false, message: "Not found" });
  }
  for (const route of ["/api-docs/", "/api-docs/openapi.json", "/api-docs/swagger-ui-init.js"]) {
    assert.equal((await fetch(base + route, { headers: { Authorization: authorization } })).status, 404);
  }
});

test("generic UTF-16 BE rejects malformed wire Unicode even in ignored JSON fields", async () => {
  calls.length = 0;
  // Literal unpaired UTF-16 code units, not JSON-escaped text.
  const body = Buffer.from('{"userId":"victim","coordinate":{"lat":35,"lng":51},"ignored":"\ud800"}', "utf16le").swap16();
  const response = await fetch(base + "/location/upsert", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-16" }, body,
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("well-formed generic UTF-16 BE/LE with or without BOM keeps identifiers intact", async () => {
  for (const bigEndian of [false, true]) for (const bom of [false, true]) {
    const text = '{"userId":"شناسه😀","coordinate":{"lat":35,"lng":51}}';
    let body = Buffer.from(text, "utf16le");
    if (bigEndian) body = body.swap16();
    if (bom) body = Buffer.concat([Buffer.from(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]), body]);
    const response = await fetch(base + "/location/upsert", {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-16" }, body,
    });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1)[0], "شناسه😀");
    await response.arrayBuffer();
  }
});

test("configuration and operational pools reject malformed URI components without echoing credentials", () => {
  const safeDiagnostic = error => /DATABASE_URL/.test(error.message)
    && !error.message.includes("private-password") && !error.message.includes("private-user");
  for (const suffix of ["?application_name=%G0", "?application_name=%FF", "?application_name=%00", "#fragment"]) {
    const connectionString = "postgresql://private-user:private-password@localhost/nearby" + suffix;
    assert.throws(() => parseConfig({ NODE_ENV: "test", DATABASE_URL: connectionString }), safeDiagnostic);
    assert.throws(() => withPostgresOptions({ connectionString }, {}), safeDiagnostic);
  }
  assert.throws(() => parseConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://private:secret@%FF/nearby" }), /DATABASE_URL/);
});

test("explicit TLS disable ignores ambient PGSSLMODE while URI-owned TLS remains available", () => {
  const { Client } = require("pg");
  const previous = process.env.PGSSLMODE;
  try {
    process.env.PGSSLMODE = "require";
    const client = new Client(withPostgresOptions({ connectionString: "postgresql://localhost/nearby" }, { PG_SSL: "false" }));
    assert.equal(client.connectionParameters.ssl, false);
    const owned = new Client(withPostgresOptions({ connectionString: "postgresql://localhost/nearby?sslmode=verify-full" }, { PG_SSL: "false" }));
    assert.deepEqual(owned.connectionParameters.ssl, {});
  } finally {
    if (previous === undefined) delete process.env.PGSSLMODE;
    else process.env.PGSSLMODE = previous;
  }
});

test("migration startup validates the URI before the CLI can print raw input", () => {
  const result = spawnSync(process.execPath, ["scripts/run-migration.js", "up", "--help"], {
    cwd: require("node:path").resolve(__dirname, ".."), encoding: "utf8", timeout: 10000,
    env: { ...process.env, DATABASE_URL: "postgresql://private-user:private-password@localhost/nearby?x=%FF", PG_SSL: "false" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_URL/);
  assert.equal(result.stderr.includes("private-password"), false);
});

test("retention bounds and cron schedules fail at configuration parsing", () => {
  assert.throws(() => parseConfig({ NODE_ENV: "test", LOCATION_TTL_DAYS: "2147483648" }), /LOCATION_TTL_DAYS/);
  assert.throws(() => parseConfig({ NODE_ENV: "test", CLEANUP_CRON_SCHEDULE: "invalid cron" }), /CLEANUP_CRON_SCHEDULE/);
});
