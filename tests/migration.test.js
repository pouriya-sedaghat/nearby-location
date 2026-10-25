const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(root, ".migration-test-"));
const preload = path.join(temp, "capture.js");
fs.writeFileSync(path.join(temp, ".env"), "DATABASE_URL=postgresql://prod.invalid/production\n");
fs.writeFileSync(path.join(temp, ".env.development"), "DATABASE_URL=postgresql://dev.invalid/development\n");
fs.writeFileSync(preload, `require("node:child_process").spawnSync = (command, args, options) => {
  console.log(JSON.stringify({ command, args, database: options.env.DATABASE_URL }));
  return { status: 0 };
};\n`);
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
function migrate(values = {}, args = []) {
  const env = { ...process.env };
  for (const key of ["NODE_ENV", "DATABASE_URL", "PG_SSL", "PG_SSL_REJECT_UNAUTHORIZED"]) delete env[key];
  Object.assign(env, values);
  const result = spawnSync(process.execPath, ["--require", preload, path.join(root, "scripts/run-migration.js"), "up", ...args], {
    cwd: temp, env, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").at(-1));
}
test("migration always reads the single .env file and preserves process overrides", () => {
  assert.equal(migrate().database, "postgresql://prod.invalid/production");
  assert.equal(migrate({ NODE_ENV: "development" }).database, "postgresql://prod.invalid/production");
  assert.equal(migrate({ DATABASE_URL: "postgresql://explicit.invalid/explicit" }).database, "postgresql://explicit.invalid/explicit");
});
test("migration uses the configured PostgreSQL TLS certificate policy", () => {
  assert.ok(migrate({ PG_SSL: "true" }).args.includes("--reject-unauthorized=true"));
  assert.ok(migrate({ PG_SSL: "true", PG_SSL_REJECT_UNAUTHORIZED: "false" }).args.includes("--reject-unauthorized=false"));
  assert.ok(!migrate({ PG_SSL: "false" }).args.some((value) => value.startsWith("--reject-unauthorized")));
  const explicit = migrate({ PG_SSL: "true" }, ["--reject-unauthorized=false"]);
  assert.deepEqual(explicit.args.filter((value) => value.startsWith("--reject-unauthorized")), ["--reject-unauthorized=false"]);
});
