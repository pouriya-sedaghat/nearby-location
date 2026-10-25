const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const fs = require("node:fs");
const modulePath = path.resolve(__dirname, "../dist/config/env");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(root, ".config-test-"));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
const keys = ["NODE_ENV", "DATABASE_URL", "PORT", "BASE_URL", "SWAGGER_ENABLED", "SWAGGER_TRY_IT_OUT_ENABLED",
  "SWAGGER_AUTH_USERNAME", "SWAGGER_AUTH_PASSWORD", "DEFAULT_MAX_DISTANCE_METERS", "MAX_MAX_DISTANCE_METERS"];
function config(values = {}, cwd = temp) {
  const env = { ...process.env };
  for (const key of keys) delete env[key];
  Object.assign(env, { DATABASE_URL: "postgresql://test.invalid/nearby" }, values);
  const result = spawnSync(process.execPath, ["-e", `console.log(JSON.stringify(require(${JSON.stringify(modulePath)}).loadConfig()))`], { cwd, env, encoding: "utf8" });
  return { ...result, value: result.status === 0 ? JSON.parse(result.stdout.trim()) : null };
}
test("Swagger exposure follows the runtime environment and execution defaults to enabled", () => {
  for (const mode of ["development", "production", "test"]) {
    const result = config({ NODE_ENV: mode });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.value.SWAGGER_ENABLED, mode === "development");
    assert.equal(result.value.SWAGGER_TRY_IT_OUT_ENABLED, true);
    assert.equal(result.value.BASE_URL, "/");
  }
});
test("production Swagger requires paired credentials independently of Try it out", () => {
  assert.notEqual(config({ NODE_ENV: "production", SWAGGER_ENABLED: "true" }).status, 0);
  const result = config({ NODE_ENV: "production", SWAGGER_ENABLED: "true", SWAGGER_AUTH_USERNAME: "docs", SWAGGER_AUTH_PASSWORD: "x".repeat(32) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.value.SWAGGER_TRY_IT_OUT_ENABLED, true);
  assert.equal(config({ SWAGGER_TRY_IT_OUT_ENABLED: "false" }).value.SWAGGER_TRY_IT_OUT_ENABLED, false);
  assert.notEqual(config({ SWAGGER_AUTH_USERNAME: "docs" }).status, 0);
  assert.notEqual(config({ SWAGGER_AUTH_USERNAME: "docs", SWAGGER_AUTH_PASSWORD: "short" }).status, 0);
  assert.notEqual(config({ SWAGGER_ENABLED: "yes" }).status, 0);
});
test("radius limits reject blanks, invalid ranges and inconsistent defaults", () => {
  for (const value of ["", " ", "0", "-1", "NaN", "20000001"]) {
    assert.notEqual(config({ MAX_MAX_DISTANCE_METERS: value }).status, 0, value);
  }
  assert.notEqual(config({ DEFAULT_MAX_DISTANCE_METERS: "2000", MAX_MAX_DISTANCE_METERS: "1000" }).status, 0);
  const result = config({ DEFAULT_MAX_DISTANCE_METERS: "500", MAX_MAX_DISTANCE_METERS: "2000" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.value.DEFAULT_MAX_DISTANCE_METERS, 500);
});
test("OpenAPI base URL accepts proxy paths and rejects credentials or query fragments", () => {
  for (const value of ["/", "/nearby", "https://api.example.com/nearby"]) assert.equal(config({ BASE_URL: value }).status, 0);
  for (const value of ["//example.com", "relative", "/bad path", "/x?y=1", "https://u:p@example.com", "https://example.com/#x"]) assert.notEqual(config({ BASE_URL: value }).status, 0);
});

test("timeout values reject overflow instead of becoming near-immediate Node timers", () => {
  for (const key of ["PG_IDLE_TIMEOUT_MS", "PG_CONN_TIMEOUT_MS", "PG_STATEMENT_TIMEOUT_MS"]) {
    assert.notEqual(config({ [key]: "2147483648" }).status, 0, key);
    assert.equal(config({ [key]: "2147483647" }).status, 0, key);
  }
});

test("invalid cleanup schedules fail configuration before connecting to PostgreSQL", () => {
  assert.notEqual(config({ CLEANUP_CRON_SCHEDULE: "not a cron expression" }).status, 0);
  assert.equal(config({ CLEANUP_CRON_SCHEDULE: "0 3 * * *" }).status, 0);
});

test("OpenAPI URLs reject raw whitespace and backslash normalization", () => {
  for (const BASE_URL of [" https://example.com", "https://example.com ", "https://example.com/a b", "https:\\\\example.com"]) {
    assert.notEqual(config({ BASE_URL }).status, 0, BASE_URL);
  }
});

test("the production default is also applied to Express", () => {
  const env = { ...process.env, SWAGGER_ENABLED: "false" };
  delete env.NODE_ENV;
  const result = spawnSync(process.execPath, ["-e",
    `const {createApp}=require(${JSON.stringify(path.join(root, "dist/app"))}); const {parseConfig}=require(${JSON.stringify(modulePath)}); const app=createApp({config:parseConfig({DATABASE_URL:"postgresql://test.invalid/nearby"}),database:{},locations:{}}); console.log(app.get('env'));`],
    { cwd: temp, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "production");
});


test("service reads .env in every mode, ignores legacy files and keeps process overrides", () => {
  const cwd = path.join(temp, "configured");
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, ".env"), "DATABASE_URL=postgresql://single.invalid/nearby\nPORT=8181\n");
  for (const mode of ["development", "production", "test"]) {
    fs.writeFileSync(path.join(cwd, ".env." + mode), "DATABASE_URL=postgresql://legacy.invalid/wrong\n");
    const result = config({ NODE_ENV: mode, DATABASE_URL: undefined }, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.value.DATABASE_URL, "postgresql://single.invalid/nearby");
    assert.equal(result.value.PORT, 8181);
  }
  const result = config({ DATABASE_URL: "postgresql://process.invalid/override", PORT: "9191" }, cwd);
  assert.equal(result.value.DATABASE_URL, "postgresql://process.invalid/override");
  assert.equal(result.value.PORT, 9191);
});


test("database configuration fails early without exposing invalid credentials", () => {
  const { parseConfig } = require("../dist/config/env");
  assert.throws(() => parseConfig({}), /DATABASE_URL/);
  for (const DATABASE_URL of ["", "not-a-uri", "https://test.invalid/db", "postgresql://user:synthetic-private-value@host:bad/db",
    "postgresql://user:%ZZ@host/db", "postgresql://host/db path"]) {
    assert.throws(() => parseConfig({ DATABASE_URL }), error => {
      assert.match(error.message, /DATABASE_URL/);
      assert.ok(!error.message.includes("synthetic-private-value"));
      return true;
    });
  }
  for (const DATABASE_URL of ["postgresql://host/db", "postgres://u:p%40ss@localhost:5432/db",
    "postgresql:///db?host=%2Fvar%2Frun%2Fpostgresql"]) {
    assert.equal(parseConfig({ DATABASE_URL }).DATABASE_URL, DATABASE_URL);
  }
});
