# Configuration reference

[Documentation index](README.md) · [Deployment](DEPLOYMENT.md) · [Operations](OPERATIONS.md)

## Loading and precedence

Run from the repository root. The server and database tools load only `.env`, without overriding exported variables. Precedence is **process environment → `.env` → application defaults**. `NODE_ENV` changes runtime behavior, not the configuration filename.

The runtime validates configuration with [Zod](../src/config/env.ts) and fails startup on invalid values. Boolean environment values must be the literal strings `true` or `false`. Numeric values cannot be empty or whitespace-only; such a value fails startup instead of becoming `0` (an explicit `0` remains valid where the range allows it). Only optional Swagger switches treat an empty value as an omitted/default value. Optional secret fields treat whitespace-only values as absent.

The tables list every application variable. Numeric values use the units in the table. `unset` means there is no default. Operational-tool variables are described in [testing](TESTING.md) and [operations](OPERATIONS.md); they have their own validation and are not all runtime settings.

## Runtime and documentation

| Variable | Application default | Constraints and purpose |
|---|---|---|
| `NODE_ENV` | `production` | `production`, `development`, or `test`; `production` limits diagnostic error detail |
| `PORT` | `8080` | Integer 1–65,535 |
| `BASE_URL` | `/` | HTTP(S) URL or absolute path; no credentials, query, fragment, whitespace, or backslash; OpenAPI server only |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `SWAGGER_ENABLED` | True in development, false otherwise | Mount UI and live OpenAPI routes; empty preserves default |
| `SWAGGER_TRY_IT_OUT_ENABLED` | True in development, false otherwise | UI execution; empty preserves default |
| `SWAGGER_AUTH_USERNAME` | unset | 1–64 characters; letters, digits, underscore, dot, hyphen; configured with password |
| `SWAGGER_AUTH_PASSWORD` | unset | 32–256 printable ASCII characters without spaces; required for enabled docs outside development |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Positive integer up to 2,147,483,647; total shutdown deadline |
| `SHUTDOWN_DRAIN_DELAY_MS` | `2000` | Integer 0–120,000, strictly below shutdown timeout; routing propagation delay |
| `RUN_MIGRATIONS_ON_STARTUP` | `true` | Docker entrypoint only; direct Node starts never run migrations automatically |

## Database

| Variable | Application default | Constraints and purpose |
|---|---|---|
| `DATABASE_URL` | Required in production; local fallback in test/development | Valid PostgreSQL URI without whitespace or malformed credential escaping |
| `PG_POOL_MAX` | `10` | Positive integer; maximum connections per process |
| `PG_APPLICATION_NAME` | `nearby-location` | Trimmed 1–63 characters; database diagnostics |
| `PG_KEEP_ALIVE_INITIAL_DELAY_MS` | `10000` | Integer 0–300,000 |
| `PG_IDLE_TIMEOUT_MS` | `30000` | Integer 0–2,147,483,647; `0` disables idle-connection eviction |
| `PG_CONN_TIMEOUT_MS` | `5000` | Positive integer up to 2,147,483,647 |
| `PG_STATEMENT_TIMEOUT_MS` | `2000` | Positive integer up to 2,147,483,647; foreground statements |
| `PG_CONNECT_RETRIES` | `10` | Positive integer; startup attempts |
| `PG_CONNECT_BASE_DELAY_MS` | `1000` | Positive integer up to 2,147,483,647; exponential startup delay, capped at 30 seconds per wait |
| `PG_SSL` | `false` | Enable explicit TLS connection options |
| `PG_SSL_REJECT_UNAUTHORIZED` | `true` | Verify certificates when explicit TLS is enabled |

**TLS configuration:** use one owner. With `PG_SSL=true`, remove URL parameters `ssl`, `sslmode`, `sslcert`, `sslkey`, `sslrootcert`, `uselibpqcompat`, and `sslnegotiation`; conflicting configuration is rejected. Alternatively let the connection URL own TLS while `PG_SSL=false`, and review those URL semantics explicitly. Prefer verified TLS and provision trusted certificates through the deployment platform. Server and database tools share [these checks](../scripts/lib/postgres-options.js).

The supplied Kubernetes Secret example has no URL TLS parameters, so it matches the ConfigMap's explicit verified TLS (`PG_SSL=true`, `PG_SSL_REJECT_UNAUTHORIZED=true`); a regression test loads the unchanged pair through the server and migration checks. Keep URL TLS parameters out of your real Secret while the ConfigMap owns TLS. See [deployment preparation](DEPLOYMENT.md#prepare-cluster-specific-files).

## Search and ranking

| Variable | Application default | Constraints and purpose |
|---|---|---|
| `DEFAULT_MAX_DISTANCE_METERS` | `10000` | Positive; at most the configured maximum |
| `MAX_MAX_DISTANCE_METERS` | `100000` | Positive finite number up to 20,000,000; API radius cap |
| `RANKING_MODE` | `legacy` | `legacy` or `decay`; shared across a serving fleet |
| `RANKING_DISTANCE_SCALE_METERS` | `2000` | Positive finite number up to 20,000,000; decay spatial scale |
| `RANKING_FRESHNESS_HALF_LIFE_MINUTES` | `60` | Positive finite number up to 525,600 |
| `RANKING_DISTANCE_WEIGHT` | `0.65` | Finite 0–1,000,000 |
| `RANKING_FRESHNESS_WEIGHT` | `0.35` | Finite 0–1,000,000; sum of weights must be positive |

Changing the decay mode/profile changes ranking and invalidates existing decay cursors. Validate ordering and rollout behavior before changing fleet settings. The [architecture](ARCHITECTURE.md#ranking) explains the formulas.

## Cursors and service authentication

| Variable | Application default | Constraints and purpose |
|---|---|---|
| `CURSOR_MAX_AGE_MINUTES` | `60` | Integer 1–10,080; v3 session and decay reference lifetime |
| `CURSOR_SIGNING_SECRET` | unset | At least 32 characters; signs new cursors |
| `CURSOR_SIGNING_PREVIOUS_SECRET` | unset | At least 32 characters; verification during rotation; requires primary key |
| `CURSOR_REQUIRE_SIGNATURE` | `false` | Reject unsigned cursors; requires primary signing key |
| `LOCATION_AUTH_MODE` | `disabled` | `disabled` or `bearer` |
| `LOCATION_AUTH_TOKEN` | unset | Required in bearer mode; token rules below |
| `LOCATION_AUTH_PREVIOUS_TOKEN` | unset | Accepted during rotation; requires primary token |
| `METRICS_AUTH_MODE` | `disabled` | `disabled` or `bearer` |
| `METRICS_AUTH_TOKEN` | unset | Required in bearer mode |
| `METRICS_AUTH_PREVIOUS_TOKEN` | unset | Accepted during rotation; requires primary token |
| `PRIVACY_API_ENABLED` | `false` | Mount normalized and exact erasure routes; requires privacy token |
| `PRIVACY_AUTH_TOKEN` | unset | Dedicated erasure token |
| `PRIVACY_AUTH_PREVIOUS_TOKEN` | unset | Accepted during rotation; requires primary token |
| `HTTP_TRUST_PROXY` | `false` | When true, Express trusts proxy headers; enable only behind a fully controlled ingress boundary |

Bearer tokens require at least 32 printable ASCII characters without spaces. Use independently generated values for each surface and for cursor signing. Secrets are fixed at process initialization; changing a Secret or environment file requires a process/pod restart. See [rotation](OPERATIONS.md#credential-and-cursor-key-rotation).

## Retention and cleanup

| Variable | Application default | Constraints and purpose |
|---|---|---|
| `LOCATION_TTL_DAYS` | `7` | Positive integer; read eligibility and physical cleanup policy |
| `CLEANUP_CRON_SCHEDULE` | `0 3 * * *` | Nonempty valid node-cron expression; process timezone |
| `CLEANUP_BATCH_SIZE` | `5000` | Integer 1–50,000 |
| `CLEANUP_MAX_BATCHES_PER_RUN` | `100` | Integer 1–10,000 |
| `CLEANUP_BATCH_DELAY_MS` | `25` | Integer 0–60,000 between full batches |
| `CLEANUP_STATEMENT_TIMEOUT_MS` | `15000` | Integer 1–600,000; transaction-local cleanup statement limit |
| `CLEANUP_LOCK_TIMEOUT_MS` | `1000` | Integer 0–60,000; transaction-local lock limit; `0` disables it |

Cleanup also runs at startup. The default cap is 500,000 selected deletions per run, subject to available stale rows and successful batches. Read eligibility does not wait for cleanup. Choose retention and cleanup lag with the data owner; see [privacy](PRIVACY_AND_RETENTION.md).

## Admission, adaptive control, and rate limiting

| Variable | Application default | Constraints and purpose |
|---|---|---|
| `ADMISSION_ENABLED` | `true` | Enable concurrency, pool-pressure, and circuit admission |
| `NEARBY_MAX_IN_FLIGHT` | `50` | Integer 1–100,000; per-process nearby cap |
| `UPSERT_MAX_IN_FLIGHT` | `100` | Integer 1–100,000; per-process upsert cap |
| `PG_POOL_WAITING_REJECT_THRESHOLD` | `10` | Integer 1–100,000; reject at/above pool waiting threshold |
| `DB_CIRCUIT_FAILURE_THRESHOLD` | `5` | Integer 1–10,000; consecutive availability failures |
| `DB_CIRCUIT_OPEN_MS` | `5000` | Integer 1–600,000 |
| `ADAPTIVE_ADMISSION_ENABLED` | `false` | Adjust effective admission limits locally |
| `ADAPTIVE_NEARBY_MIN_IN_FLIGHT` | `5` | Integer 1–100,000; at most nearby cap when adaptive enabled |
| `ADAPTIVE_UPSERT_MIN_IN_FLIGHT` | `10` | Integer 1–100,000; at most upsert cap when adaptive enabled |
| `ADAPTIVE_NEARBY_LATENCY_TARGET_MS` | `250` | Positive finite number up to 60,000; database-operation latency |
| `ADAPTIVE_UPSERT_LATENCY_TARGET_MS` | `100` | Positive finite number up to 60,000; database-operation latency |
| `ADAPTIVE_INITIAL_LIMIT_PERCENT` | `50` | Integer 1–100; initial fraction of each cap |
| `ADAPTIVE_EWMA_ALPHA` | `0.2` | Finite 0.05–1; smoothing factor |
| `ADAPTIVE_INCREASE_EVERY` | `20` | Integer 1–100,000; healthy samples before additive increase |
| `ADAPTIVE_DECREASE_FACTOR` | `0.8` | Finite 0.1–0.95; multiplicative reduction |
| `ADAPTIVE_DECREASE_COOLDOWN_MS` | `1000` | Integer 0–60,000 |
| `RATE_LIMIT_ENABLED` | `false` | Local fixed-window IP/workload limiting, independent of admission switch |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Integer 1–3,600,000 |
| `RATE_LIMIT_NEARBY_MAX` | `120` | Integer 1–10,000,000 per key/window |
| `RATE_LIMIT_UPSERT_MAX` | `240` | Integer 1–10,000,000 per key/window |
| `RATE_LIMIT_MAX_KEYS` | `10000` | Integer 1–1,000,000; bounded local key map |

These controls do not apply a fleet-wide quota, and privacy deletion bypasses the location admission controller. Measure actual rejection and latency rates before changing limits. Increasing replicas can exhaust PostgreSQL even if each process stays below its local cap.

## Deployment profile differences

| Setting | Root Compose | VM evaluation | Kubernetes base |
|---|---|---|---|
| Image/runtime | Fixed production target/environment | Production image/environment | Production image/environment |
| Database | Internal PostGIS with generated private password | Internal PostGIS with generated password | External database from Secret |
| API exposure | Loopback host port | `127.0.0.1:8080` by default | ClusterIP port 80 → pod 8080 |
| Startup migrations | Enabled by default | Enabled | Disabled; separate Job |
| Location / metrics auth | Disabled by default | Bearer / bearer | Disabled compatibility defaults; change for production or enforce an equivalent boundary |
| Privacy | Disabled by default | Enabled with dedicated token | Disabled by default |
| Signed cursors required | False by default | True | True; primary key required |
| Explicit DB TLS | False by default | False on isolated container network | True, certificate verification true |
| Adaptive admission | False by default | False | True |
| Shutdown deadline | 10 seconds | 10 seconds | 25 seconds |
| Platform grace | 60 seconds | 20 seconds | 40 seconds including a 5-second preStop hook |
| Swagger | Enabled with generated Basic credentials | Explicitly disabled unless overridden | Disabled |

The VM profile hardcodes several settings, including `RANKING_MODE=legacy` and a seven-day TTL; adding a different value to `.env.vm` does not override a hardcoded Compose value. Root Compose forwards a broader set of settings. Read the actual manifests when adapting profiles.

## Recommended production baseline

Choose a database, verified transport, ingress policy, and secret source first. Then provision bearer tokens, a shared cursor key, `CURSOR_REQUIRE_SIGNATURE=true`, a deliberate privacy mode, and Swagger disabled or authenticated/view-only. Disable per-pod startup migrations in orchestrated releases. Retain fixed/adaptive controls at measured values and budget pools across maximum replicas, surge, canary, terminating pods, and external clients.

This baseline is completed by [deployment](DEPLOYMENT.md), [security](SECURITY.md), and [environment acceptance](PRODUCTION_READINESS.md); it is not a substitute for workload and recovery evidence.
