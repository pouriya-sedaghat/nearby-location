const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

let implementation;
let released;
let checkedOut;
let releaseFlags;
const fakePool = {
  on: () => {},
  connect: async () => {
    checkedOut += 1;
    return { query: async (sql) => implementation(sql), release: (destroy) => { released += 1; releaseFlags.push(destroy); } };
  },
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "pg") return { Pool: function() { return fakePool; } };
  if (request === "../config/env") return { config: {} };
  if (request === "./logger") return { logger: { info: () => {}, warn: () => {} } };
  return originalLoad.call(this, request, parent, isMain);
};
const db = require("../dist/utils/db").default;
Module._load = originalLoad;

test.beforeEach(() => { released = 0; checkedOut = 0; releaseFlags = []; });

test("failed startup queries release each client before the next retry", async () => {
  const failure = new Error("probe failed");
  implementation = () => { throw failure; };
  await assert.rejects(db.connect(3, 0), failure);
  assert.equal(checkedOut, 3);
  assert.equal(released, 3);
});

test("a successful retry releases its client too", async () => {
  let attempts = 0;
  implementation = () => { if (++attempts === 1) throw new Error("first probe failed"); };
  await db.connect(3, 0);
  assert.equal(checkedOut, 2);
  assert.equal(released, 2);
});

test("advisory lock acquisition or unlock uncertainty destroys the pooled session", async () => {
  const failure = new Error("connection lost");
  implementation = () => { throw failure; };
  await assert.rejects(db.withAdvisoryLock(1, 2, async () => {}), failure);
  assert.deepEqual(releaseFlags, [true]);

  implementation = (sql) => {
    if (sql.includes("pg_advisory_unlock")) throw failure;
    return { rows: [{ acquired: true }] };
  };
  const result = await db.withAdvisoryLock(1, 2, async () => "completed");
  assert.equal(result.value, "completed");
  assert.deepEqual(releaseFlags, [true, true]);
});

test("a failed task preserves its error and unlocks before returning a reusable session", async () => {
  const queries = [];
  implementation = (sql) => { queries.push(sql); return { rows: [{ acquired: true }] }; };
  const failure = new Error("task failed");
  await assert.rejects(db.withAdvisoryLock(1, 2, async () => { throw failure; }), failure);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /pg_advisory_unlock/);
  assert.deepEqual(releaseFlags, [false]);
});

test("an unavailable advisory lock skips work and releases its session", async () => {
  implementation = () => ({ rows: [{ acquired: false }] });
  const result = await db.withAdvisoryLock(1, 2, async () => assert.fail("must not execute"));
  assert.deepEqual(result, { acquired: false });
  assert.deepEqual(releaseFlags, [false]);
});

test("termination cancels a retry delay instead of waiting for the next startup attempt", async () => {
  const abort = new AbortController();
  implementation = () => { throw new Error("database unavailable"); };
  const pending = db.connect(3, 10000, abort.signal);
  setImmediate(() => abort.abort());
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(checkedOut, 1);
  assert.equal(released, 1);
});
