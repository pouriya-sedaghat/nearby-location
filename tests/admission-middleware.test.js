const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");
const { AdmissionController } = require("../dist/utils/admission-core");

let controller;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "../config/env") return { config: { RATE_LIMIT_ENABLED: false } };
  if (request === "../utils/admission") return { admission: {
    consumeRateLimit: () => ({ allowed: true }),
    tryAcquire: (workload) => controller.tryAcquire(workload, 0),
  } };
  if (request === "../utils/lifecycle") return { lifecycle: { isDraining: () => false } };
  if (request === "../utils/logger") return { logger: { warn: () => {} } };
  if (request === "../utils/metrics") return { metrics: { recordAdmissionRejection: () => {} } };
  return originalLoad.call(this, request, parent, isMain);
};
const { admissionMiddleware } = require("../dist/middleware/admission.middleware");
Module._load = originalLoad;

const response = () => Object.assign(new EventEmitter(), {
  locals: {}, setHeader: () => {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const req = { ip: "127.0.0.1", socket: {} };
test.beforeEach(() => { controller = new AdmissionController({
  nearbyMaxInFlight: 1, upsertMaxInFlight: 1,
  poolWaitingRejectThreshold: 10, circuitFailureThreshold: 5, circuitOpenMs: 1000,
}); });

test("closed responses retain admission capacity until the database handler settles", async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  let executions = 0;
  const admitted = admissionMiddleware("nearby", async () => { executions++; await pending; });
  const first = response();
  const operation = admitted(req, first, assert.ifError);
  first.emit("close");
  first.emit("finish");
  assert.equal(controller.snapshot().nearbyInFlight, 1);
  const second = response();
  await admitted(req, second, assert.ifError);
  assert.equal(second.statusCode, 503);
  assert.equal(executions, 1);
  complete();
  await operation;
  assert.equal(controller.snapshot().nearbyInFlight, 0);
  await admitted(req, response(), assert.ifError);
  assert.equal(executions, 2);
});

test("rejected async handlers release capacity and forward their error to Express", async () => {
  const failure = new Error("handler failed");
  let forwarded;
  await admissionMiddleware("upsert", async () => { throw failure; })(req, response(), (err) => { forwarded = err; });
  assert.equal(forwarded, failure);
  assert.equal(controller.snapshot().upsertInFlight, 0);
});
