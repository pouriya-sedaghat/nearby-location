const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

let query;
let releases;
const client = { query: (sql) => query(sql), release: (destroy) => releases.push(destroy) };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "../config/env") return { config: { CLEANUP_STATEMENT_TIMEOUT_MS: 15000, CLEANUP_LOCK_TIMEOUT_MS: 1000 } };
  if (request === "../config/ranking") return { rankingProfile: { mode: "legacy" } };
  if (request === "../utils/db") return { pool: { connect: async () => client } };
  return originalLoad.call(this, request, parent, isMain);
};
const { deleteStaleLocations } = require("../dist/models/location.model");
Module._load = originalLoad;
test.beforeEach(() => { releases = []; });

test("failed cleanup rollback destroys an owned session and preserves the original error", async () => {
  const failure = new Error("delete failed");
  query = async (sql) => {
    if (sql.includes("DELETE FROM")) throw failure;
    if (sql === "ROLLBACK") throw new Error("rollback failed");
    return { rowCount: 0 };
  };
  await assert.rejects(deleteStaleLocations(7, 5000), failure);
  assert.deepEqual(releases, [true]);
  releases = [];
  await assert.rejects(deleteStaleLocations(7, 5000, client), failure);
  assert.deepEqual(releases, [], "the advisory-lock owner must release its borrowed session");
});

test("successful rollback makes the owned cleanup session reusable", async () => {
  const failure = new Error("delete failed");
  const operations = [];
  query = async (sql) => {
    operations.push(sql);
    if (sql.includes("DELETE FROM")) throw failure;
    return { rowCount: 0 };
  };
  await assert.rejects(deleteStaleLocations(7, 5000), failure);
  assert.equal(operations.at(-1), "ROLLBACK");
  assert.deepEqual(releases, [false]);
});
