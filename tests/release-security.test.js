const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
process.env.NODE_ENV = "test";
const root = path.resolve(__dirname, "..");

test("production startup refuses missing or malformed database URIs without exposing their contents", () => {
  const { parseConfig } = require("../dist/config/env");
  assert.throws(() => parseConfig({ NODE_ENV: "production" }), /DATABASE_URL is required/);
  assert.throws(() => parseConfig({ NODE_ENV: "prod", DATABASE_URL: "postgresql://test.invalid/nearby" }), /NODE_ENV/);
  for (const value of ["https://private:secret@db.invalid/test", "postgresql://private:bad%xx@db.invalid/test", "postgresql://db.invalid/with space"]) {
    assert.throws(() => parseConfig({ NODE_ENV: "production", DATABASE_URL: value }), error =>
      /DATABASE_URL/.test(error.message) && !error.message.includes("private") && !error.message.includes("secret"));
  }
});

test("identifier bounds remain UTF-16 code units after the validator update", () => {
  const { userIdSchema, exactStoredUserIdSchema } = require("../dist/schemas/request.schema");
  for (const schema of [userIdSchema, exactStoredUserIdSchema]) {
    assert.equal(schema.safeParse("😀".repeat(127) + "x").success, true);
    assert.equal(schema.safeParse("😀".repeat(128)).success, false);
  }
});

test("OpenAPI export ignores invalid runtime settings and stays identical to the distributed contract", () => {
  const result = spawnSync(process.execPath, ["scripts/export-openapi.js", "--check"], {
    cwd: root, encoding: "utf8", env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "invalid", BASE_URL: "//invalid", DEFAULT_MAX_DISTANCE_METERS: "invalid" },
  });
  assert.equal(result.status, 0, result.stderr);
  const spec = JSON.parse(fs.readFileSync(path.join(root, "docs/openapi.json")));
  assert.equal(spec.info.version, require("../package.json").version);
  assert.equal(spec.components.parameters.ResponseLanguage.name, "Accept-Language");
});

test("request-derived metric labels have bounded method and route cardinality", () => {
  const { metrics } = require("../dist/utils/metrics");
  for (let i = 0; i < 100; i++) metrics.observeHttpRequest("ATTACK_" + i, "/private/" + i, 404, 0.001);
  const text = metrics.renderPrometheus();
  assert.doesNotMatch(text, /ATTACK_|\/private\//);
  assert.match(text, /method="OTHER"/);
  assert.match(text, /route="\/not_found"/);
});
