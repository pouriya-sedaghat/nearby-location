const dotenv = require("dotenv");
const { Pool } = require("pg");
const { withPostgresOptions } = require("./lib/postgres-options");
const { calculateConnectionCapacity } = require("./lib/capacity");

dotenv.config({ path: ".env", override: false, quiet: true });

const readNumber = (name, fallback, min, max) => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const expectedReplicas = Math.trunc(
  readNumber("CAPACITY_EXPECTED_REPLICAS", 1, 1, 10000),
);
const poolMax = Math.trunc(readNumber("PG_POOL_MAX", 10, 1, 10000));
const externalReserve = Math.trunc(
  readNumber("CAPACITY_EXTERNAL_RESERVE_CONNECTIONS", 20, 0, 100000),
);
const maxUtilizationPercent = readNumber(
  "CAPACITY_MAX_UTILIZATION_PERCENT",
  70,
  1,
  100,
);

const pool = new Pool(withPostgresOptions({
  connectionString: databaseUrl,
  max: 1,
  application_name: "nearby-capacity-check",
}));

(async () => {
  try {
    const result = await pool.query(`
      SELECT name, setting::int AS value
      FROM pg_settings
      WHERE name IN (
        'max_connections',
        'superuser_reserved_connections',
        'reserved_connections'
      )
    `);
    const settings = Object.fromEntries(
      result.rows.map((row) => [row.name, Number(row.value)]),
    );
    if (!Number.isInteger(settings.max_connections) || settings.max_connections <= 0) {
      throw new Error("Could not read PostgreSQL max_connections");
    }

    const summary = calculateConnectionCapacity({
      maxConnections: settings.max_connections,
      superuserReservedConnections:
        settings.superuser_reserved_connections ?? 0,
      reservedConnections: settings.reserved_connections ?? 0,
      expectedReplicas,
      poolMax,
      externalReserve,
      maxUtilizationPercent,
    });

    console.log(JSON.stringify(summary, null, 2));
    if (!summary.passed) process.exitCode = 2;
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
