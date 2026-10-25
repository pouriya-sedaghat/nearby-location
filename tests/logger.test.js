const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const config = { NODE_ENV: "production", LOG_LEVEL: "debug" };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "../config/env") return { config };
  return originalLoad.call(this, request, parent, isMain);
};
const { logger } = require("../dist/utils/logger");
Module._load = originalLoad;
const capture = (operation) => {
  const original = console.error;
  let output;
  console.error = (line) => { output = line; };
  try { operation(); } finally { console.error = original; }
  return JSON.parse(output);
};

test("production errors retain diagnostic codes without database messages or raw location fields", () => {
  const error = Object.assign(new Error("invalid value for sensitive-user at 35.6892,51.389"), { code: "22000" });
  const payload = capture(() => logger.error("db_operation_failed", {
    error, requestId: "request-1", reason: "concurrency",
    userId: "sensitive-user", coordinate: { lat: 35.6892, lng: 51.389 },
    nested: { DATABASE_URL: "postgres://secret", token: "secret-token" },
  }));
  assert.deepEqual(payload.error, { name: "Error", code: "22000" });
  assert.equal(payload.reason, "concurrency");
  assert.equal(payload.userId, "[REDACTED]");
  assert.equal(payload.coordinate, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(payload), /sensitive-user|35\.6892|secret-token|postgres:\/\//);
  assert.deepEqual(capture(() => logger.error("unexpected_failure", { error: "raw-secret" })).error, { name: "UnknownError" });
});

test("development logging keeps the error message and stack for debugging", () => {
  config.NODE_ENV = "development";
  try {
    const payload = capture(() => logger.error("debug_failure", { error: new Error("debug detail") }));
    assert.equal(payload.error.message, "debug detail");
    assert.match(payload.error.stack, /debug detail/);
  } finally { config.NODE_ENV = "production"; }
});
