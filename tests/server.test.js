const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function start(port, options = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, "fixtures/service-runner.js"), JSON.stringify({ port, ...options })], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", () => {
      if (stdout.includes("Nearby Location Service running on port")) resolve();
    });
    exited.then(result => reject(new Error("Exited before ready: " + JSON.stringify(result))), reject);
  });
  ready.catch(() => {});
  const waitFor = text => new Promise((resolve, reject) => {
    if (stdout.includes(text)) return resolve();
    child.stdout.on("data", () => { if (stdout.includes(text)) resolve(); });
    exited.then(result => reject(new Error("Exited before " + text + ": " + JSON.stringify(result))), reject);
  });
  return { child, exited, ready, waitFor };

}
async function port() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return number;
}
test("listen failure closes the database and does not start cleanup", { timeout: 5000 }, async t => {
  const occupied = http.createServer();
  await new Promise(resolve => occupied.listen(0, "0.0.0.0", resolve));
  const run = start(occupied.address().port);
  t.after(() => { run.child.kill("SIGKILL"); occupied.close(); });
  const result = await run.exited;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Failed to start server/);
  assert.match(result.stdout, /DB_CLOSED/);
  assert.doesNotMatch(result.stdout, /CLEANUP_STARTED/);
});
test("SIGTERM drains cleanup before closing the database", { timeout: 5000 }, async t => {
  const run = start(await port());
  t.after(() => run.child.kill("SIGKILL"));
  await run.ready;
  run.child.kill("SIGTERM");
  const result = await run.exited;
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /CLEANUP_STOPPED/);
  assert.ok(result.stdout.indexOf("CLEANUP_STOPPED") < result.stdout.indexOf("DB_CLOSED"));
});
test("shutdown failure reports a nonzero exit status", { timeout: 5000 }, async t => {
  const run = start(await port(), { disconnectFailure: true });
  t.after(() => run.child.kill("SIGKILL"));
  await run.ready;
  run.child.kill("SIGTERM");
  const result = await run.exited;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /shutdown failed/i);
});
test("cleanup startup failure closes the already-open listener and database", { timeout: 5000 }, async t => {
  const run = start(await port(), { cleanupFailure: true });
  t.after(() => run.child.kill("SIGKILL"));
  const result = await run.exited;
  assert.equal(result.code, 1);
  assert.match(result.stdout, /DB_CLOSED/);
  assert.match(result.stderr, /cleanup startup failed/);
});

test("SIGTERM during startup cancels connection work and releases the database", { timeout: 5000 }, async t => {
  const run = start(await port(), { connectDelay: 30000 });
  t.after(() => run.child.kill("SIGKILL"));
  await run.waitFor("CONNECTING");
  run.child.kill("SIGTERM");
  const result = await run.exited;
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /DB_CLOSED/);
  assert.doesNotMatch(result.stdout, /CLEANUP_STARTED|Service running/);
});
test("repeated termination signals share one graceful shutdown", { timeout: 5000 }, async t => {
  const run = start(await port(), { cleanupDelay: 150 });
  t.after(() => run.child.kill("SIGKILL"));
  await run.ready;
  run.child.kill("SIGTERM");
  await run.waitFor("shutting down gracefully");
  run.child.kill("SIGTERM");
  const result = await run.exited;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.match(/DB_CLOSED/g).length, 1);
  assert.equal(result.stdout.match(/CLEANUP_STOPPED/g).length, 1);
});
test("shutdown lets an active HTTP request finish before database disposal", { timeout: 5000 }, async t => {
  const number = await port();
  const run = start(number, { requestDelay: 100 });
  t.after(() => run.child.kill("SIGKILL"));
  await run.ready;
  const request = fetch(`http://127.0.0.1:${number}/location/upsert`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "drain-test", coordinate: { lat: 0, lng: 0 } }) });
  await run.waitFor("REQUEST_STARTED");
  run.child.kill("SIGTERM");
  assert.equal((await request).status, 200);
  const result = await run.exited;
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.indexOf("REQUEST_FINISHED") < result.stdout.indexOf("DB_CLOSED"));
});

test("the real entrypoint cancels database retries when terminated before readiness", { timeout: 5000 }, async t => {
  const unused = await port();
  const child = spawn(process.execPath, [path.join(root, "dist/server.js")], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", SWAGGER_ENABLED: "false",
      DATABASE_URL: `postgresql://test:test-only@127.0.0.1:${unused}/unavailable`,
      PG_CONNECT_RETRIES: "100", PG_CONNECT_BASE_DELAY_MS: "30000", PG_CONN_TIMEOUT_MS: "100" },
  });
  t.after(() => child.kill("SIGKILL"));
  let output = "";
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => {
      output += data;
      if (output.includes("PostgreSQL connection attempt 1/100 failed")) resolve();
    });
    exited.then(result => reject(new Error("Exited before a retry: " + JSON.stringify(result) + output)), reject);
  });
  child.kill("SIGTERM");
  const result = await exited;
  assert.equal(result.code, 0, output);
  assert.match(output, /PostgreSQL pool closed/);
  assert.doesNotMatch(output, /Service running|attempt 2\/100/);
});
