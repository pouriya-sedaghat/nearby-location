const assert = require("node:assert/strict");
const test = require("node:test");

const { LifecycleController } = require("../dist/utils/lifecycle-core");

test("lifecycle starts unready and transitions to ready once", () => {
  const lifecycle = new LifecycleController();
  assert.equal(lifecycle.isReady(), false);
  assert.equal(lifecycle.snapshot().state, "starting");
  assert.equal(lifecycle.markReady(), true);
  assert.equal(lifecycle.markReady(), false);
  assert.equal(lifecycle.isReady(), true);
});

test("draining immediately makes readiness false and is idempotent", () => {
  const lifecycle = new LifecycleController();
  lifecycle.markReady();
  assert.equal(lifecycle.startDraining("SIGTERM", 1234), true);
  assert.equal(lifecycle.isReady(), false);
  assert.equal(lifecycle.isDraining(), true);
  assert.equal(lifecycle.startDraining("SIGINT", 2000), false);
  assert.deepEqual(lifecycle.snapshot(), {
    state: "draining",
    activeRequests: 0,
    drainStartedAtMs: 1234,
    drainReason: "SIGTERM",
  });
});

test("request tracking releases exactly once and survives drain", () => {
  const lifecycle = new LifecycleController();
  lifecycle.markReady();
  const first = lifecycle.beginRequest();
  const second = lifecycle.beginRequest();
  assert.equal(lifecycle.snapshot().activeRequests, 2);

  lifecycle.startDraining("SIGTERM", 1000);
  first();
  first();
  assert.equal(lifecycle.snapshot().activeRequests, 1);
  second();
  assert.equal(lifecycle.snapshot().activeRequests, 0);
});

test("stopped lifecycle cannot become ready again", () => {
  const lifecycle = new LifecycleController();
  lifecycle.markReady();
  lifecycle.markStopped();
  assert.equal(lifecycle.snapshot().state, "stopped");
  assert.equal(lifecycle.markReady(), false);
  assert.equal(lifecycle.isReady(), false);
});
