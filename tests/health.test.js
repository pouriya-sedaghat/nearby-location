const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { LifecycleController } = require("../dist/utils/lifecycle-core");

let lifecycle;
let ping;
let pingCalls;
let failures;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "../utils/lifecycle") return { lifecycle: {
    isReady: () => lifecycle.isReady(), snapshot: () => lifecycle.snapshot(),
  } };
  if (request === "../utils/db") return { __esModule: true, default: {
    ping: async () => { pingCalls += 1; return ping(); },
  } };
  if (request === "../utils/logger") return { logger: { warn: () => {} } };
  if (request === "../utils/metrics") return { metrics: { recordDbError: () => { failures += 1; } } };
  if (request === "../utils/admission") return { admission: {
    snapshot: () => ({ circuitState: "closed" }), recordDbFailure: () => {},
  } };
  return originalLoad.call(this, request, parent, isMain);
};
const { readiness } = require("../dist/controllers/health.controller");
Module._load = originalLoad;
const response = () => ({
  locals: {}, status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
test.beforeEach(() => {
  lifecycle = new LifecycleController();
  ping = async () => {};
  pingCalls = 0;
  failures = 0;
});

test("readiness is unavailable during startup without querying PostgreSQL", async () => {
  const res = response();
  await readiness({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.reason, "starting");
  assert.equal(pingCalls, 0);
});

test("readiness succeeds only when the lifecycle and database are ready", async () => {
  lifecycle.markReady();
  const res = response();
  await readiness({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "ready");
  assert.equal(pingCalls, 1);
});

test("a probe started before draining cannot return ready after its DB check", async () => {
  lifecycle.markReady();
  let finishPing;
  ping = () => new Promise((resolve) => { finishPing = resolve; });
  const res = response();
  const pending = readiness({}, res);
  lifecycle.startDraining("test");
  finishPing();
  await pending;
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.reason, "draining");
  assert.equal(failures, 0);
});

test("readiness skips the DB once draining starts", async () => {
  lifecycle.markReady();
  lifecycle.startDraining("test");
  const res = response();
  await readiness({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.reason, "draining");
  assert.equal(pingCalls, 0);
});

test("readiness reports database failure as unavailable", async () => {
  lifecycle.markReady();
  ping = async () => { throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); };
  const res = response();
  await readiness({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, "not_ready");
  assert.equal(failures, 1);
});
