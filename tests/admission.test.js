const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AdmissionController,
  AdaptiveConcurrencyController,
  FixedWindowRateLimiter,
  classifyPgErrorCode,
  classifyDatabaseError,
} = require("../dist/utils/admission-core");

const settings = {
  nearbyMaxInFlight: 2,
  upsertMaxInFlight: 1,
  poolWaitingRejectThreshold: 3,
  circuitFailureThreshold: 2,
  circuitOpenMs: 5000,
};

test("database classification recognizes network codes, driver timeouts, and wrapped errors", () => {
  for (const error of [
    { code: "ECONNRESET" }, { code: "ECONNREFUSED" }, { code: "ETIMEDOUT" },
    { code: "EAI_AGAIN" }, new Error("timeout exceeded when trying to connect"),
    new Error("Connection terminated unexpectedly"),
    new Error("Connection terminated due to connection timeout"),
    new Error("wrapped", { cause: { code: "EPIPE" } }),
    new AggregateError([{ code: "ENETUNREACH" }]),
  ]) assert.deepEqual(classifyDatabaseError(error), { retryable: true, tripCircuit: true });
  for (const error of [{ code: "40001" }, { code: "40P01" }, new Error("Query read timeout")]) {
    assert.deepEqual(classifyDatabaseError(error), { retryable: true, tripCircuit: false });
  }
  for (const error of [null, new TypeError("invalid SQL"), { code: "23505" }, new Error("random timeout")]) {
    assert.deepEqual(classifyDatabaseError(error), { retryable: false, tripCircuit: false });
  }
  const circular = {}; circular.cause = circular;
  assert.deepEqual(classifyDatabaseError(circular), { retryable: false, tripCircuit: false });
});

test("admission enforces per-workload concurrency and releases exactly once", () => {
  const controller = new AdmissionController(settings);
  const first = controller.tryAcquire("nearby", 0, 1000);
  const second = controller.tryAcquire("nearby", 0, 1000);
  const rejected = controller.tryAcquire("nearby", 0, 1000);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.deepEqual(rejected, {
    accepted: false,
    reason: "concurrency",
    retryAfterSeconds: 1,
  });

  first.release();
  first.release();
  assert.equal(controller.snapshot(1000).nearbyInFlight, 1);
  assert.equal(controller.tryAcquire("nearby", 0, 1000).accepted, true);
});

test("admission rejects before adding more work to a saturated pool queue", () => {
  const controller = new AdmissionController(settings);
  assert.deepEqual(controller.tryAcquire("upsert", 3, 1000), {
    accepted: false,
    reason: "pool_queue",
    retryAfterSeconds: 1,
  });
  assert.equal(controller.snapshot(1000).upsertInFlight, 0);
});

test("circuit opens after retryable failures and uses one half-open probe", () => {
  const controller = new AdmissionController(settings);
  controller.recordDbFailure(true, 1000);
  controller.recordDbFailure(true, 1001);

  const open = controller.tryAcquire("nearby", 0, 2000);
  assert.equal(open.accepted, false);
  assert.equal(open.reason, "circuit_open");
  assert.equal(controller.snapshot(2000).circuitState, "open");

  const probe = controller.tryAcquire("nearby", 0, 6001);
  assert.equal(probe.accepted, true);
  assert.equal(probe.probe, true);
  assert.equal(controller.tryAcquire("upsert", 0, 6001).accepted, false);

  controller.recordDbSuccess();
  probe.release();
  assert.equal(controller.snapshot(6001).circuitState, "closed");
  assert.equal(controller.tryAcquire("upsert", 0, 6001).accepted, true);
});

test("half-open retryable failure reopens the circuit", () => {
  const controller = new AdmissionController({
    ...settings,
    circuitFailureThreshold: 1,
  });
  controller.recordDbFailure(true, 1000);
  const probe = controller.tryAcquire("nearby", 0, 6000);
  assert.equal(probe.accepted, true);
  controller.recordDbFailure(true, 6000);
  probe.release();

  const rejected = controller.tryAcquire("nearby", 0, 6001);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "circuit_open");
});

test("non-retryable database failures do not trip the circuit", () => {
  const controller = new AdmissionController({
    ...settings,
    circuitFailureThreshold: 1,
  });
  controller.recordDbFailure(false, 1000);
  assert.equal(controller.snapshot(1000).circuitState, "closed");
});

test("fixed-window limiter rejects at the limit and resets next window", () => {
  const limiter = new FixedWindowRateLimiter(1000, 100);
  assert.deepEqual(limiter.consume("nearby:client", 2, 1000), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0,
  });
  assert.deepEqual(limiter.consume("nearby:client", 2, 1100), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 0,
  });
  const rejected = limiter.consume("nearby:client", 2, 1200);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 1);
  assert.equal(limiter.consume("nearby:client", 2, 2000).allowed, true);
});

test("PostgreSQL SQLSTATE classification separates query overload from DB availability", () => {
  assert.deepEqual(classifyPgErrorCode("57014"), {
    retryable: true,
    tripCircuit: false,
  });
  assert.deepEqual(classifyPgErrorCode("55P03"), {
    retryable: true,
    tripCircuit: false,
  });
  assert.deepEqual(classifyPgErrorCode("08006"), {
    retryable: true,
    tripCircuit: true,
  });
  assert.deepEqual(classifyPgErrorCode("23505"), {
    retryable: false,
    tripCircuit: false,
  });
});


test("adaptive concurrency starts conservatively and increases additively on healthy latency", () => {
  const adaptive = new AdaptiveConcurrencyController({
    enabled: true,
    nearbyConfiguredMax: 10,
    upsertConfiguredMax: 20,
    nearbyMin: 2,
    upsertMin: 4,
    nearbyLatencyTargetMs: 100,
    upsertLatencyTargetMs: 50,
    initialLimitPercent: 50,
    ewmaAlpha: 1,
    increaseEvery: 2,
    decreaseFactor: 0.5,
    decreaseCooldownMs: 1000,
  });

  assert.equal(adaptive.effectiveLimit("nearby"), 5);
  assert.equal(adaptive.observeSuccess("nearby", 50, 1000), null);
  assert.deepEqual(adaptive.observeSuccess("nearby", 50, 1001), {
    workload: "nearby",
    direction: "increase",
    reason: "recovery",
    previousLimit: 5,
    effectiveLimit: 6,
  });
  assert.equal(adaptive.snapshot().nearby.latencyEwmaMs, 50);
});

test("adaptive concurrency decreases on high latency with cooldown and respects minimum", () => {
  const adaptive = new AdaptiveConcurrencyController({
    enabled: true,
    nearbyConfiguredMax: 10,
    upsertConfiguredMax: 20,
    nearbyMin: 2,
    upsertMin: 4,
    nearbyLatencyTargetMs: 100,
    upsertLatencyTargetMs: 50,
    initialLimitPercent: 60,
    ewmaAlpha: 1,
    increaseEvery: 2,
    decreaseFactor: 0.5,
    decreaseCooldownMs: 1000,
  });

  assert.equal(adaptive.effectiveLimit("nearby"), 6);
  assert.deepEqual(adaptive.observeSuccess("nearby", 200, 2000), {
    workload: "nearby",
    direction: "decrease",
    reason: "latency",
    previousLimit: 6,
    effectiveLimit: 3,
  });
  assert.equal(adaptive.observeSuccess("nearby", 200, 2500), null);
  assert.deepEqual(adaptive.observeSuccess("nearby", 200, 3001), {
    workload: "nearby",
    direction: "decrease",
    reason: "latency",
    previousLimit: 3,
    effectiveLimit: 2,
  });
  assert.equal(adaptive.observeSuccess("nearby", 200, 5000), null);
  assert.equal(adaptive.effectiveLimit("nearby"), 2);
});

test("adaptive concurrency reacts to pool pressure and retryable failures", () => {
  const adaptive = new AdaptiveConcurrencyController({
    enabled: true,
    nearbyConfiguredMax: 10,
    upsertConfiguredMax: 20,
    nearbyMin: 2,
    upsertMin: 4,
    nearbyLatencyTargetMs: 100,
    upsertLatencyTargetMs: 50,
    initialLimitPercent: 50,
    ewmaAlpha: 0.2,
    increaseEvery: 20,
    decreaseFactor: 0.5,
    decreaseCooldownMs: 1000,
  });

  assert.deepEqual(adaptive.observePoolPressure("upsert", 1000), {
    workload: "upsert",
    direction: "decrease",
    reason: "pool_queue",
    previousLimit: 10,
    effectiveLimit: 5,
  });
  assert.deepEqual(adaptive.observeFailure("upsert", 100, 2001), {
    workload: "upsert",
    direction: "decrease",
    reason: "failure",
    previousLimit: 5,
    effectiveLimit: 4,
  });
  assert.equal(adaptive.effectiveLimit("upsert"), 4);
});

test("disabled adaptive concurrency preserves configured hard limits", () => {
  const adaptive = new AdaptiveConcurrencyController({
    enabled: false,
    nearbyConfiguredMax: 10,
    upsertConfiguredMax: 20,
    nearbyMin: 2,
    upsertMin: 4,
    nearbyLatencyTargetMs: 100,
    upsertLatencyTargetMs: 50,
    initialLimitPercent: 10,
    ewmaAlpha: 1,
    increaseEvery: 1,
    decreaseFactor: 0.5,
    decreaseCooldownMs: 0,
  });

  assert.equal(adaptive.effectiveLimit("nearby"), 10);
  assert.equal(adaptive.effectiveLimit("upsert"), 20);
  assert.equal(adaptive.observePoolPressure("nearby", 1000), null);
});
