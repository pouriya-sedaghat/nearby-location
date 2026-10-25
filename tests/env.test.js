const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const token = "config-test-token-with-32-characters";
const bearerKeys = [
  "LOCATION_AUTH_TOKEN", "LOCATION_AUTH_PREVIOUS_TOKEN",
  "METRICS_AUTH_TOKEN", "METRICS_AUTH_PREVIOUS_TOKEN",
  "PRIVACY_AUTH_TOKEN", "PRIVACY_AUTH_PREVIOUS_TOKEN",
];
const base = {
  ...process.env, DATABASE_URL: "postgresql://test.invalid/nearby", NODE_ENV: "test", SHUTDOWN_DRAIN_DELAY_MS: "0",
  SWAGGER_ENABLED: "", SWAGGER_TRY_IT_OUT_ENABLED: "",
  SWAGGER_AUTH_USERNAME: "", SWAGGER_AUTH_PASSWORD: "",
  ...Object.fromEntries(bearerKeys.map((key) => [key, token])),
};
const loadConfig = (changes, code = "require('./dist/config/env')") => spawnSync(process.execPath, ["-e", code], {
  cwd: path.resolve(__dirname, ".."), env: { ...base, ...changes }, encoding: "utf8", timeout: 5000,
});

test("Swagger defaults follow the environment while explicit flags override them", () => {
  const snapshot = (changes) => {
    const result = loadConfig(changes, "const {config}=require('./dist/config/env');console.log(JSON.stringify({enabled:config.SWAGGER_ENABLED,interactive:config.SWAGGER_TRY_IT_OUT_ENABLED,baseUrl:config.BASE_URL}))");
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(snapshot({ NODE_ENV: "development" }), { enabled: true, interactive: true, baseUrl: "/" });
  assert.deepEqual(snapshot({ NODE_ENV: "production" }), { enabled: false, interactive: false, baseUrl: "/" });
  assert.equal(snapshot({ NODE_ENV: "development", SWAGGER_ENABLED: "false" }).enabled, false);
  assert.deepEqual(snapshot({ NODE_ENV: "production", SWAGGER_ENABLED: "true", SWAGGER_AUTH_USERNAME: "docs", SWAGGER_AUTH_PASSWORD: token }), { enabled: true, interactive: false, baseUrl: "/" });
  for (const key of ["SWAGGER_ENABLED", "SWAGGER_TRY_IT_OUT_ENABLED"]) {
    assert.equal(loadConfig({ [key]: "yes" }).status, 1);
  }
});

test("Swagger outside development requires paired, valid documentation credentials", () => {
  for (const changes of [
    { NODE_ENV: "production", SWAGGER_ENABLED: "true" },
    { SWAGGER_AUTH_USERNAME: "docs" },
    { SWAGGER_AUTH_PASSWORD: token },
    { SWAGGER_AUTH_USERNAME: "invalid:user", SWAGGER_AUTH_PASSWORD: token },
    { SWAGGER_AUTH_USERNAME: "docs", SWAGGER_AUTH_PASSWORD: "short" },
    { SWAGGER_AUTH_USERNAME: "docs", SWAGGER_AUTH_PASSWORD: "x".repeat(257) },
  ]) {
    const result = loadConfig(changes);
    assert.equal(result.status, 1, JSON.stringify(changes));
    assert.match(result.stderr, /SWAGGER_AUTH/);
    assert.equal(result.stderr.includes(token), false);
  }
});

test("OpenAPI base URLs accept same-origin paths and HTTP URLs without credentials", () => {
  for (const url of ["/", "/nearby", "https://api.example.test/nearby"]) {
    assert.equal(loadConfig({ BASE_URL: url }).status, 0, url);
  }
  for (const url of ["//other.example.test", "relative", "https://user:password@example.test", "https://example.test/?token=secret", "ftp://example.test", "/nearby#fragment", "https://example.test/with space", "https://example.test/\\path", " https://example.test/"]) {
    const result = loadConfig({ BASE_URL: url });
    assert.equal(result.status, 1, url);
    assert.match(result.stderr, /BASE_URL/);
    assert.equal(result.stderr.includes(url), false);
  }
});

test("timer configuration rejects values that Node would turn into a 1 ms delay", () => {
  const keys = ["SHUTDOWN_TIMEOUT_MS", "PG_IDLE_TIMEOUT_MS", "PG_CONN_TIMEOUT_MS", "PG_STATEMENT_TIMEOUT_MS", "PG_CONNECT_BASE_DELAY_MS"];
  const boundary = loadConfig(Object.fromEntries(keys.map((key) => [key, "2147483647"])));
  assert.equal(boundary.status, 0, boundary.stderr);
  for (const key of keys) {
    const result = loadConfig({ [key]: "2147483648" });
    assert.equal(result.status, 1, key);
    assert.match(result.stderr, new RegExp(key));
  }
  assert.equal(loadConfig({ PG_IDLE_TIMEOUT_MS: "0" }).status, 0);
});

test("server refuses TLS URL options that could override explicit verification", () => {
  const databaseUrl = 'postgresql://sensitive-user:sensitive-password@localhost/test?sslmode=no-verify';
  const result = loadConfig({PG_SSL:'true',DATABASE_URL:databaseUrl}, "require('./dist/utils/db')");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_URL TLS parameters conflict/);
  assert.equal(result.stderr.includes('sensitive-password'), false);
});

test("bearer tokens must be transportable in headers while cursor HMAC keys remain opaque", () => {
  for (const key of bearerKeys) {
    for (const suffix of [" with-space", "\u0007", "界"]) {
      const result = loadConfig({ [key]: `${token}${suffix}` });
      assert.equal(result.status, 1, key);
      assert.match(result.stderr, new RegExp(key));
      assert.equal(result.stderr.includes(`${token}${suffix}`), false);
    }
  }
  assert.equal(loadConfig({ CURSOR_SIGNING_SECRET: `${token} with-space` }).status, 0);
});

test("blank numeric settings fail startup instead of silently becoming zero", () => {
  // z.coerce.number("") is 0: an empty CLEANUP_LOCK_TIMEOUT_MS would disable
  // the lock timeout and an empty ranking weight would change ordering.
  for (const key of [
    "CLEANUP_LOCK_TIMEOUT_MS", "CLEANUP_BATCH_DELAY_MS", "PG_IDLE_TIMEOUT_MS",
    "PG_KEEP_ALIVE_INITIAL_DELAY_MS", "SHUTDOWN_DRAIN_DELAY_MS",
    "RANKING_DISTANCE_WEIGHT", "RANKING_FRESHNESS_WEIGHT", "ADAPTIVE_DECREASE_COOLDOWN_MS",
    "PORT", "PG_POOL_MAX",
  ]) {
    for (const value of ["", "   "]) {
      const result = loadConfig({ [key]: value });
      assert.equal(result.status, 1, `${key}=${JSON.stringify(value)}`);
      assert.match(result.stderr, new RegExp(`${key}: .*empty`));
    }
  }
  const zeroes = loadConfig({ CLEANUP_LOCK_TIMEOUT_MS: "0", PG_IDLE_TIMEOUT_MS: "0", SHUTDOWN_DRAIN_DELAY_MS: "0" },
    "const {config}=require('./dist/config/env');console.log(config.CLEANUP_LOCK_TIMEOUT_MS+config.PG_IDLE_TIMEOUT_MS+config.SHUTDOWN_DRAIN_DELAY_MS)");
  assert.equal(zeroes.status, 0, zeroes.stderr);
  assert.equal(zeroes.stdout.trim(), "0");
});
