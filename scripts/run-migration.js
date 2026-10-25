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

const result = spawnSync(process.execPath, [cli, action, ...args, ...migrationTlsArgs(args)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
