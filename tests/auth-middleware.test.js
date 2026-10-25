const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const primary = "a".repeat(40);
const previous = "b".repeat(40);
const config = {
  LOCATION_AUTH_MODE: "bearer",
  LOCATION_AUTH_TOKEN: primary,
  LOCATION_AUTH_PREVIOUS_TOKEN: previous,
  METRICS_AUTH_MODE: "disabled",
  METRICS_AUTH_TOKEN: undefined,
  METRICS_AUTH_PREVIOUS_TOKEN: undefined,
  PRIVACY_API_ENABLED: true,
  PRIVACY_AUTH_TOKEN: "c".repeat(40),
  PRIVACY_AUTH_PREVIOUS_TOKEN: "d".repeat(40),
};
const authFailures = [];
const warnings = [];

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "../config/env") return { config };
  if (request === "../utils/logger") {
    return { logger: { warn: (message, fields) => warnings.push({ message, fields }) } };
  }
  if (request === "../utils/metrics") {
    return { metrics: { recordAuthFailure: (...args) => authFailures.push(args) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const middlewarePath = path.resolve(__dirname, "../dist/middleware/auth.middleware.js");
delete require.cache[middlewarePath];
const { authorizationMiddleware } = require(middlewarePath);
Module._load = originalLoad;

const invoke = (surface, authorization) => {
  let statusCode;
  let body;
  let nextCalls = 0;
  const headers = new Map();
  const req = { header: (name) => (name.toLowerCase() === "authorization" ? authorization : undefined) };
  const res = {
    locals: { requestId: "req-test" },
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    status: (code) => { statusCode = code; return res; },
    json: (value) => { body = value; return res; },
  };
  authorizationMiddleware(surface)(req, res, () => { nextCalls += 1; });
  return { statusCode, body, nextCalls, headers };
};

test("location auth rejects missing bearer token before controller", () => {
  authFailures.length = 0;
  warnings.length = 0;
  const result = invoke("location", undefined);
  assert.equal(result.nextCalls, 0);
  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { success: false, message: "Unauthorized" });
  assert.equal(result.headers.get("www-authenticate"), 'Bearer realm="nearby-location"');
  assert.deepEqual(authFailures, [["location", "missing"]]);
  assert.equal(JSON.stringify(warnings).includes(primary), false);
});

test("location auth accepts current and previous rotation tokens", () => {
  assert.equal(invoke("location", `Bearer ${primary}`).nextCalls, 1);
  assert.equal(invoke("location", `Bearer ${previous}`).nextCalls, 1);
});

test("metrics auth disabled mode remains probe/scrape compatible", () => {
  assert.equal(invoke("metrics", undefined).nextCalls, 1);
});

test("privacy auth always requires its dedicated token when the surface is mounted", () => {
  assert.equal(invoke("privacy", undefined).statusCode, 401);
  assert.equal(
    invoke("privacy", `Bearer ${config.PRIVACY_AUTH_TOKEN}`).nextCalls,
    1,
  );
  assert.equal(
    invoke("privacy", `Bearer ${config.PRIVACY_AUTH_PREVIOUS_TOKEN}`).nextCalls,
    1,
  );
});
