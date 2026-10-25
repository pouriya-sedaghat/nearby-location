const dotenv = require("dotenv");
const { Pool } = require("pg");
const { withPostgresOptions } = require("./lib/postgres-options");
const { evaluatePrivacyAudit } = require("./lib/privacy-audit");

dotenv.config({ path: ".env", override: false, quiet: true });

const readInt = (name, fallback, min, max) => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ttlDays = readInt("LOCATION_TTL_DAYS", 7, 1, 36500);
const cleanupGraceHours = readInt(
  "PRIVACY_AUDIT_CLEANUP_GRACE_HOURS",
  48,
  0,
  24 * 365,
);
const maxOverdueRows = readInt("PRIVACY_AUDIT_MAX_OVERDUE_ROWS", 0, 0, 1_000_000_000);
const maxFutureRows = readInt("PRIVACY_AUDIT_MAX_FUTURE_ROWS", 0, 0, 1_000_000_000);
const futureToleranceMinutes = readInt(
  "PRIVACY_AUDIT_FUTURE_TOLERANCE_MINUTES",
  5,
  0,
  24 * 60,
);

const pool = new Pool(withPostgresOptions({
  connectionString: databaseUrl,
  max: 1,
  application_name: "nearby-privacy-audit",
}));

(async () => {
  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS total_rows,
        COUNT(*) FILTER (
          WHERE updated_at < now() - make_interval(days => $1::int)
        )::bigint AS stale_rows_past_ttl,
        COUNT(*) FILTER (
          WHERE updated_at <
            now()
            - make_interval(days => $1::int)
            - make_interval(hours => $2::int)
        )::bigint AS overdue_rows,
        COUNT(*) FILTER (
          WHERE updated_at > now() + make_interval(mins => $3::int)
        )::bigint AS future_rows,
        COUNT(*) FILTER (
          WHERE updated_at >= now() - interval '1 hour'
        )::bigint AS rows_last_hour,
        COUNT(*) FILTER (
          WHERE updated_at >= now() - interval '24 hours'
        )::bigint AS rows_last_24_hours,
        MIN(updated_at) AS oldest_updated_at,
        MAX(updated_at) AS newest_updated_at
      FROM locations
      `,
      [ttlDays, cleanupGraceHours, futureToleranceMinutes],
    );

    const row = result.rows[0] ?? {};
    const summary = {
      policy: {
        ttlDays,
        cleanupGraceHours,
        futureToleranceMinutes,
        maxOverdueRows,
        maxFutureRows,
      },
      totals: {
        totalRows: Number(row.total_rows ?? 0),
        staleRowsPastTtl: Number(row.stale_rows_past_ttl ?? 0),
        overdueRows: Number(row.overdue_rows ?? 0),
        futureRows: Number(row.future_rows ?? 0),
        rowsLastHour: Number(row.rows_last_hour ?? 0),
        rowsLast24Hours: Number(row.rows_last_24_hours ?? 0),
      },
      oldestUpdatedAt: row.oldest_updated_at ?? null,
      newestUpdatedAt: row.newest_updated_at ?? null,
    };

    const evaluation = evaluatePrivacyAudit({
      overdueRows: summary.totals.overdueRows,
      futureRows: summary.totals.futureRows,
      maxOverdueRows,
      maxFutureRows,
    });

    console.log(JSON.stringify({ ...summary, ...evaluation }, null, 2));
    if (!evaluation.passed) process.exitCode = 2;
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
