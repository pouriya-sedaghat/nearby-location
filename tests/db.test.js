const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { parseConfig } = require("../dist/config/env");
const { createDatabase, createPoolConfig } = require("../dist/utils/db");
const { quietLogger } = require("./fixtures/app.factory");
const make = (values = {}) => {
  const config = parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby", PG_CONNECT_RETRIES: "3", PG_CONNECT_BASE_DELAY_MS: "1", ...values });
  const pool = new EventEmitter();
  pool.end = async () => {};
  pool.query = async () => ({ rows: [] });
  return { pool, db: createDatabase(config, { pool, logger: quietLogger }) };
};
test("startup discards failed probe connections and releases the successful one", async () => {
  const { db, pool } = make();
  const failure = new Error("probe failed");
  const releases = [];
  let attempts = 0;
  pool.connect = async () => {
    const attempt = ++attempts;
    return { query: async () => { if (attempt < 3) throw failure; },
      release: error => releases.push({ attempt, error }) };
  };
  await db.connect();
  assert.equal(attempts, 3);
  assert.deepEqual(releases, [{ attempt: 1, error: failure }, { attempt: 2, error: failure }, { attempt: 3, error: undefined }]);
});
test("exhausted startup retries release every acquired client and preserve the error", async () => {
  const { db, pool } = make({ PG_CONNECT_RETRIES: "2" });
  const failure = new Error("database unavailable");
  let released = 0;
  pool.connect = async () => ({ query: async () => { throw failure; },
    release: error => { assert.equal(error, failure); released++; } });
  await assert.rejects(db.connect(), error => error === failure);
  assert.equal(released, 2);
});
test("connection acquisition failure is retried without masking the error", async () => {
  const { db, pool } = make({ PG_CONNECT_RETRIES: "2" });
  const failure = new Error("connection refused");
  let attempts = 0;
  pool.connect = async () => { attempts++; throw failure; };
  await assert.rejects(db.connect(), error => error === failure);
  assert.equal(attempts, 2);
});
test("shutdown cancels a pending retry delay before another connection attempt", async () => {
  const { db, pool } = make({ PG_CONNECT_BASE_DELAY_MS: "30000" });
  const controller = new AbortController();
  let attempts = 0;
  pool.connect = async () => { attempts++; throw new Error("unavailable"); };
  const pending = db.connect(controller.signal);
  setImmediate(() => controller.abort());
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(attempts, 1);
});
test("cancellation during acquisition discards the acquired client", async () => {
  const { db, pool } = make();
  const controller = new AbortController();
  let released = 0, queried = 0;
  pool.connect = async () => {
    controller.abort();
    return { query: async () => { queried++; }, release: () => { released++; } };
  };
  await assert.rejects(db.connect(controller.signal), { name: "AbortError" });
  assert.equal(queried, 0);
  assert.equal(released, 1);
});
test("database disposal is idempotent", async () => {
  const { db, pool } = make();
  let ended = 0;
  pool.end = async () => { ended++; };
  const first = db.disconnect();
  assert.equal(db.disconnect(), first);
  await first;
  assert.equal(ended, 1);
});
test("pool settings consistently apply explicit TLS certificate policy", () => {
  assert.equal(createPoolConfig(parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby" })).ssl, undefined);
  assert.deepEqual(createPoolConfig(parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby", PG_SSL: "true" })).ssl, { rejectUnauthorized: true });
  assert.deepEqual(createPoolConfig(parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby", PG_SSL: "true", PG_SSL_REJECT_UNAUTHORIZED: "false" })).ssl,
    { rejectUnauthorized: false });
});
