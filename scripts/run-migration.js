const { spawnSync } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");
const { migrationTlsArgs } = require("./lib/postgres-options");

dotenv.config({
  path: ".env",
  override: false,
  quiet: true,
});

const [, , action, ...args] = process.argv;

if (!action) {
  console.error("Migration action is required (up, down, create, ...)");
  process.exit(1);
}

const cli = path.resolve(
  __dirname,
  "../node_modules/node-pg-migrate/bin/node-pg-migrate.js",
);

let tlsArgs;
try { tlsArgs = migrationTlsArgs(args); }
catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid migration configuration");
  process.exit(1);
}
const migrationEnv = { ...process.env, PGSSLMODE: process.env.PG_SSL === "true" ? "require" : "disable" };
const result = spawnSync(process.execPath, [cli, action, ...args, ...tlsArgs], {
  stdio: "inherit",
  env: migrationEnv,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
