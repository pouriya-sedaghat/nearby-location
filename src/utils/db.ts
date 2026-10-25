import { Pool, PoolClient, PoolConfig } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "../config/env";
import { logger } from "./logger";

// Shared plain-JavaScript helper is also usable before TypeScript is built,
// keeping migration/tool TLS behavior identical to the server.
const { withPostgresOptions } = require("../../scripts/lib/postgres-options");

const poolConfig: PoolConfig = withPostgresOptions({
  connectionString: config.DATABASE_URL,
  max: config.PG_POOL_MAX,
  idleTimeoutMillis: config.PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.PG_CONN_TIMEOUT_MS,
  statement_timeout: config.PG_STATEMENT_TIMEOUT_MS,
  application_name: config.PG_APPLICATION_NAME,
  keepAlive: true,
  keepAliveInitialDelayMillis: config.PG_KEEP_ALIVE_INITIAL_DELAY_MS,
}, {
  PG_SSL: String(config.PG_SSL ?? false),
  PG_SSL_REJECT_UNAUTHORIZED: String(config.PG_SSL_REJECT_UNAUTHORIZED ?? true),
  PG_CONN_TIMEOUT_MS: String(config.PG_CONN_TIMEOUT_MS ?? 5000),
});

export const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  // Errors on idle clients are surfaced through logs; the pool remains usable.
  logger.error("postgres_idle_client_error", { error: err });
});

let disconnecting: Promise<void> | undefined;
const delayRetry = (ms: number, signal?: AbortSignal) => delay(ms, undefined, { signal });

/**
 * Connects to Postgres with retry + exponential backoff. This protects the
 * service from startup races without hiding a permanent failure.
 */
const connect = async (
  retries = config.PG_CONNECT_RETRIES,
  baseDelayMs = config.PG_CONNECT_BASE_DELAY_MS,
  signal?: AbortSignal,
): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    try {
      const client = await pool.connect();
      try {
        signal?.throwIfAborted();
        await client.query("SELECT 1");
        signal?.throwIfAborted();
      } catch (error) { client.release(error instanceof Error ? error : true); throw error; }
      client.release();
      logger.info("postgres_connected", {
        attempt,
        applicationName: config.PG_APPLICATION_NAME,
        poolMax: config.PG_POOL_MAX,
        statementTimeoutMs: config.PG_STATEMENT_TIMEOUT_MS,
        connectionTimeoutMs: config.PG_CONN_TIMEOUT_MS,
      });
      return;
    } catch (err) {
      signal?.throwIfAborted();
      lastError = err;
      logger.warn("postgres_connection_attempt_failed", {
        attempt,
        retries,
        error: err,
      });

      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await delayRetry(Math.min(delay, 30_000), signal);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Exhausted PostgreSQL connection retries");
};

const ping = async (): Promise<void> => {
  await pool.query("SELECT 1");
};

/**
 * Runs a task while holding a session-level PostgreSQL advisory lock.
 *
 * The same PoolClient owns the lock for the complete task lifetime. If the
 * connection is lost PostgreSQL releases the lock automatically. The two
 * integer keys form an application-private namespace and avoid relying on
 * process-local mutexes when several service replicas are running.
 */
const withAdvisoryLock = async <T>(
  key1: number,
  key2: number,
  task: (client: PoolClient) => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> => {
  const client = await pool.connect();
  let acquired = false;
  // If acquisition fails after being sent, the server may still hold the lock.
  let discardClient = true;

  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
      [key1, key2],
    );
    acquired = result.rows[0]?.acquired === true;
    discardClient = false;

    if (!acquired) return { acquired: false };

    return {
      acquired: true,
      value: await task(client),
    };
  } finally {
    if (acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", [
          key1,
          key2,
        ]);
      } catch (err) {
        // Do not return a session with an uncertain lock state to the pool.
        discardClient = true;
        logger.warn("postgres_advisory_unlock_failed", { key1, key2, error: err });
      }
    }
    client.release(discardClient);
  }
};

const disconnect = (): Promise<void> => disconnecting ??= pool.end().then(() => { logger.info("postgres_pool_closed"); });

const db = { connect, ping, disconnect, withAdvisoryLock, pool };

export default db;
