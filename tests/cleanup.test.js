const assert = require("node:assert/strict");
const test = require("node:test");
const cron = require("node-cron");
const { parseConfig } = require("../dist/config/env");
const { startCleanupJob } = require("../dist/jobs/cleanup.job");
const { quietLogger } = require("./fixtures/app.factory");
const config = parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby" });
const make = (deleteStaleLocations, stopFailure) => {
  let callback, stops = 0, destroys = 0;
  const task = startCleanupJob(config, { deleteStaleLocations }, quietLogger, (_expression, run) => {
    callback = run;
    return { stop: () => { stops++; if (stopFailure) throw stopFailure; }, destroy: () => { destroys++; } };
  });
  return { task, run: () => callback(), counts: () => ({ stops, destroys }) };
};
test("cleanup stop waits for the active batch and prevents another batch", async () => {
  let complete, calls = 0, done = false;
  const run = make(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  const stopped = run.task.stop();
  stopped.then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  complete(config.CLEANUP_BATCH_SIZE);
  await stopped;
  assert.equal(calls, 1);
  await run.run();
  assert.equal(calls, 1);
  assert.equal(run.task.stop(), stopped);
  assert.deepEqual(run.counts(), { stops: 1, destroys: 1 });
});
test("scheduled callbacks do not overlap an active cleanup pass", async () => {
  let complete, calls = 0;
  const run = make(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  void run.run(); void run.run();
  assert.equal(calls, 1);
  complete(0);
  await run.task.stop();
});
test("a scheduler stop failure still drains the active batch and destroys the task", async () => {
  let complete;
  const failure = new Error("scheduler stop failed");
  const run = make(() => new Promise(resolve => { complete = resolve; }), failure);
  const stopped = run.task.stop();
  complete(0);
  await assert.rejects(stopped, error => error === failure);
  assert.deepEqual(run.counts(), { stops: 1, destroys: 1 });
});
test("the real cron task is removed from the registry when disposed", async () => {
  const before = cron.getTasks().size;
  const task = startCleanupJob(config, { deleteStaleLocations: async () => 0 }, quietLogger);
  try { assert.equal(cron.getTasks().size, before + 1); }
  finally { await task.stop(); }
  assert.equal(cron.getTasks().size, before);
});
