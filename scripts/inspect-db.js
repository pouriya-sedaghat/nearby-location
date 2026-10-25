const dotenv = require("dotenv");
const { Pool } = require("pg");
const { withPostgresOptions } = require("./lib/postgres-options");

dotenv.config({ path: ".env", override: false, quiet: true });

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/nearby-location";
const pool = new Pool(withPostgresOptions({
  connectionString: databaseUrl,
  max: 1,
  application_name: "nearby-db-inspect",
}));

const safeRatio = (numerator, denominator) =>
  denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;

(async () => {
  try {
    const [version, tableStats, indexes, sizes, settings, databaseStats, activities] =
      await Promise.all([
        pool.query(`
          SELECT
            current_setting('server_version') AS postgres_version,
            (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version
        `),
        pool.query(`
          SELECT
            n_live_tup::bigint AS live_rows_estimate,
            n_dead_tup::bigint AS dead_rows_estimate,
            n_tup_ins::bigint AS inserted,
            n_tup_upd::bigint AS updated,
            n_tup_del::bigint AS deleted,
            seq_scan::bigint,
            idx_scan::bigint,
            autovacuum_count::bigint,
            autoanalyze_count::bigint,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze
          FROM pg_stat_user_tables
          WHERE schemaname = 'public' AND relname = 'locations'
        `),
        pool.query(`
          SELECT
            s.indexrelname AS name,
            s.idx_scan::bigint AS scans,
            s.idx_tup_read::bigint AS tuples_read,
            s.idx_tup_fetch::bigint AS tuples_fetched,
            pg_size_pretty(pg_relation_size(s.indexrelid)) AS size,
            pg_get_indexdef(s.indexrelid) AS definition
          FROM pg_stat_user_indexes s
          WHERE s.schemaname = 'public' AND s.relname = 'locations'
          ORDER BY s.indexrelname
        `),
        pool.query(`
          SELECT
            pg_size_pretty(pg_relation_size('public.locations')) AS table_size,
            pg_size_pretty(pg_indexes_size('public.locations')) AS indexes_size,
            pg_size_pretty(pg_total_relation_size('public.locations')) AS total_size
          WHERE to_regclass('public.locations') IS NOT NULL
        `),
        pool.query(`
          SELECT name, setting, unit
          FROM pg_settings
          WHERE name IN (
            'max_connections',
            'superuser_reserved_connections',
            'reserved_connections',
            'shared_buffers',
            'effective_cache_size',
            'work_mem',
            'maintenance_work_mem',
            'random_page_cost',
            'effective_io_concurrency',
            'autovacuum',
            'track_counts'
          )
          ORDER BY name
        `),
        pool.query(`
          SELECT
            numbackends::int,
            xact_commit::bigint,
            xact_rollback::bigint,
            blks_read::bigint,
            blks_hit::bigint,
            temp_files::bigint,
            temp_bytes::bigint,
            deadlocks::bigint
          FROM pg_stat_database
          WHERE datname = current_database()
        `),
        pool.query(`
          SELECT
            COALESCE(application_name, '') AS application_name,
            state,
            COUNT(*)::int AS connections
          FROM pg_stat_activity
          WHERE datname = current_database()
          GROUP BY application_name, state
          ORDER BY application_name, state
        `),
      ]);

    const stats = tableStats.rows[0] ?? null;
    const live = Number(stats?.live_rows_estimate ?? 0);
    const dead = Number(stats?.dead_rows_estimate ?? 0);
    const dbStats = databaseStats.rows[0] ?? null;
    const blocksRead = Number(dbStats?.blks_read ?? 0);
    const blocksHit = Number(dbStats?.blks_hit ?? 0);

    console.log(
      JSON.stringify(
        {
          versions: version.rows[0] ?? {},
          locations: stats
            ? {
                ...stats,
                live_rows_estimate: live,
                dead_rows_estimate: dead,
                dead_to_live_ratio: safeRatio(dead, live),
                index_scan_ratio: safeRatio(
                  Number(stats.idx_scan ?? 0),
                  Number(stats.idx_scan ?? 0) + Number(stats.seq_scan ?? 0),
                ),
              }
            : null,
          database: dbStats
            ? {
                ...dbStats,
                blks_read: blocksRead,
                blks_hit: blocksHit,
                cache_hit_ratio: safeRatio(blocksHit, blocksHit + blocksRead),
              }
            : null,
          sizes: sizes.rows[0] ?? null,
          indexes: indexes.rows,
          connections: activities.rows,
          settings: Object.fromEntries(
            settings.rows.map((row) => [
              row.name,
              row.unit ? `${row.setting}${row.unit}` : row.setting,
            ]),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
