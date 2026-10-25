const { spawnSync } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");

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

const migrationArgs = [cli, action, ...args];
// node-pg-migrate's CLI accepts certificate policy independently of DATABASE_URL.
if (process.env.PG_SSL === "true"
  && !args.some((arg) => /^--(?:no-)?reject-unauthorized(?:=|$)/.test(arg))) {
  migrationArgs.push(`--reject-unauthorized=${process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false"}`);
}

const result = spawnSync(process.execPath, migrationArgs, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
