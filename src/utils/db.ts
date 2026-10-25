import { Pool, PoolConfig } from "pg";
import { setTimeout as delay } from "timers/promises";
import type { AppConfig } from "../config/env";
import type { Logger } from "./logger";

export const createPoolConfig = (config: AppConfig): PoolConfig => ({
  connectionString: config.DATABASE_URL,
  max: config.PG_POOL_MAX,
  idleTimeoutMillis: config.PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.PG_CONN_TIMEOUT_MS,
  statement_timeout: config.PG_STATEMENT_TIMEOUT_MS,
  ssl: config.PG_SSL ? { rejectUnauthorized: config.PG_SSL_REJECT_UNAUTHORIZED } : undefined,
});

/** Explicit ownership lets the entrypoint create and close exactly one pool. */
export const createDatabase = (config: AppConfig, options: { pool?: Pool; logger?: Logger } = {}) => {
  const pool = options.pool ?? new Pool(createPoolConfig(config));
  const logger = options.logger ?? console;
  let disconnecting: Promise<void> | undefined;
  pool.on("error", (error) => logger.error("Unexpected error on idle Postgres client", error));

  const connect = async (signal?: AbortSignal): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= config.PG_CONNECT_RETRIES; attempt++) {
      signal?.throwIfAborted();
      try {
        const client = await pool.connect();
        try {
          signal?.throwIfAborted();
          await client.query("SELECT 1");
          signal?.throwIfAborted();
        } catch (error) {
          client.release(error instanceof Error ? error : true);
          throw error;
        }
        client.release();
        logger.log("PostgreSQL connected");
        return;
      } catch (error) {
        signal?.throwIfAborted();
        lastError = error;
        logger.error(`PostgreSQL connection attempt ${attempt}/${config.PG_CONNECT_RETRIES} failed`,
          error instanceof Error ? error.message : "Unknown database error");
        if (attempt < config.PG_CONNECT_RETRIES) {
          const ms = Math.min(config.PG_CONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), 30_000);
          await delay(ms, undefined, { signal });
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Exhausted PostgreSQL connection retries");
  };

  const ping = async (): Promise<void> => { await pool.query("SELECT 1"); };
  const disconnect = (): Promise<void> => {
    disconnecting ??= pool.end().then(() => { logger.log("PostgreSQL pool closed"); });
    return disconnecting;
  };
  return { pool, connect, ping, disconnect };
};

export type Database = ReturnType<typeof createDatabase>;
