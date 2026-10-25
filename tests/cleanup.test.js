const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

let deletes = 0;
let draining = false;
let drainAfterBatch = false;
let batchBarrier;
const client = {};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "../config/env") return { config: {
    CLEANUP_CRON_SCHEDULE: "0 3 * * *",
    CLEANUP_MAX_BATCHES_PER_RUN: 3,
    CLEANUP_BATCH_SIZE: 5000,
    CLEANUP_BATCH_DELAY_MS: 0,
    LOCATION_TTL_DAYS: 7,
  } };
  if (request === "../models/location.model") return { __esModule: true, default: {
    deleteStaleLocations: async (ttl, batchSize, actualClient) => {
      assert.equal(ttl, 7);
      assert.equal(batchSize, 5000);
      assert.equal(actualClient, client);
      deletes += 1;
      if (batchBarrier) await batchBarrier;
      if (drainAfterBatch) { draining = true; return batchSize; }
      return 0;
    },
  } };
  if (request === "../utils/db") return { __esModule: true, default: {
    withAdvisoryLock: async (_namespace, _id, task) => ({ acquired: true, value: await task(client) }),
  } };
  if (request === "../utils/logger") return { logger: { info: () => {}, warn: () => {}, error: () => {} } };
  if (request === "../utils/lifecycle") return { lifecycle: { isDraining: () => draining } };
  if (request === "../utils/metrics") return { metrics: {
    recordCleanupRun: () => {}, recordCleanupDeleted: () => {}, recordDbError: () => {},
  } };
  return originalLoad.call(this, request, parent, isMain);
};
const { startCleanupJob } = require("../dist/jobs/cleanup.job");
Module._load = originalLoad;
test.beforeEach(() => { deletes = 0; draining = false; drainAfterBatch = false; batchBarrier = undefined; });

test("cleanup runs on startup and terminal disposal removes its owned schedule", async () => {
  const task = startCleanupJob();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deletes, 1);
    await task.stop();
    await task.stop();
    assert.equal(deletes, 1);
    assert.equal(require("node-cron").getTasks().size, 0);
  } finally {
    await task.destroy();
  }
});

test("cleanup finishes its active batch and stops starting new batches when draining", async () => {
  drainAfterBatch = true;
  const task = startCleanupJob();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deletes, 1);
    await task.stop();
    assert.equal(deletes, 1, "draining must skip new batches");
  } finally { await task.destroy(); }
});

test("cleanup disposal waits for active database work and destroys the schedule once drained", async () => {
  let release;
  batchBarrier = new Promise(resolve => { release = resolve; });
  const task = startCleanupJob();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deletes, 1);
  let completed = false;
  const pending = task.stop().then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  release();
  await pending;
  await task.stop();
  assert.equal(deletes, 1);
  assert.equal(require("node-cron").getTasks().size, 0);
});
