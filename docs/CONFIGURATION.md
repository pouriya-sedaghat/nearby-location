# Configuration reference

[Documentation index](../README.md)

## Loading and precedence

There is one template (`.env.example`) and one private configuration file (`.env`). From the project root, run `./scripts/init-env.sh` once to generate independent database and documentation passwords. Never generate new credentials for a routine restart or upgrade.

The service entrypoint explicitly calls `loadConfig()`, which reads only `.env` from the working directory. `parseConfig(values)` is pure; importing application modules does not load files or modify process state. The standalone migration wrapper also reads `.env`. Precedence is:

1. Existing process environment variables.
2. `.env`.
3. Application defaults (the migration CLI has its own defaults).

`NODE_ENV` controls runtime mode and Swagger defaults; it does not select another file. Express receives the validated mode explicitly from the application factory. Run commands from the project root. The application validates settings before connecting to PostgreSQL; the migration wrapper forwards its database settings without running the full application schema.

Docker Compose reads `.env` automatically for interpolation. Only the settings explicitly mapped in `docker-compose.yaml` reach each container; the file is not copied into the image or mounted into containers. Compose fixes production mode, UTC and the internal database URL. Existing shell variables and Compose control variables can override file values or select a different project; remove stale overrides. Privileged commands use the environment seen by `sudo`.

Configuration changes require container recreation with `sudo docker compose up -d --wait --wait-timeout 180`. `restart` keeps the recorded environment. Never print resolved Compose configuration in shared logs; validate with `config --quiet`.

## Application variables

Names are case-sensitive. Boolean variables accept only the exact strings `true` and `false`. Count settings are integers; timeout units are milliseconds.

| Variable | Default | Constraint and purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Non-empty string; runtime mode and Swagger defaults |
| `PORT` | `8080` | Integer 1-65535; HTTP port |
| `BASE_URL` | `/` | Absolute path or HTTP(S) URL without credentials, query, fragment, raw whitespace, or backslashes; OpenAPI server URL only |
| `SWAGGER_ENABLED` | `true` in development; `false` elsewhere | Mounts UI, assets, and live OpenAPI |
| `SWAGGER_TRY_IT_OUT_ENABLED` | `true` | Opens Try it out and enables GET/POST Execute buttons when Swagger is enabled; explicit `false` keeps documentation read-only |
| `SWAGGER_AUTH_USERNAME` | Unset | 1-64 characters from `A-Z a-z 0-9 _ . -`; requires the password |
| `SWAGGER_AUTH_PASSWORD` | Unset | 32-256 printable non-space ASCII characters; requires the username |
| `DATABASE_URL` | Required | Valid `postgres:` or `postgresql:` URI; encode credentials, path spaces and reserved characters as URL components |
| `LOCATION_TTL_DAYS` | `7` | Positive integer; search freshness and deletion threshold |
| `CLEANUP_CRON_SCHEDULE` | `0 3 * * *` | Cron validated before database connection; 03:00 in the process timezone |
| `CLEANUP_BATCH_SIZE` | `5000` | Integer 1-50000; rows per deletion batch |
| `DEFAULT_MAX_DISTANCE_METERS` | `10000` | Positive number up to 20000000 meters; default `maxDistance` |
| `MAX_MAX_DISTANCE_METERS` | `100000` | Positive number up to 20000000 meters; inclusive radius ceiling |
| `PG_POOL_MAX` | `10` | Positive integer; maximum connections per process |
| `PG_IDLE_TIMEOUT_MS` | `30000` | Integer 0-2147483647; zero disables idle connection timeout |
| `PG_CONN_TIMEOUT_MS` | `5000` | Integer 1-2147483647; connection acquisition timeout |
| `PG_STATEMENT_TIMEOUT_MS` | `2000` | Integer 1-2147483647; PostgreSQL statement timeout |
| `PG_CONNECT_RETRIES` | `10` | Positive integer; startup connection attempts |
| `PG_CONNECT_BASE_DELAY_MS` | `1000` | Positive integer; initial exponential retry delay, capped at 30000 |
| `PG_SSL` | `false` | When true, applies explicit TLS options to the pool and migrations |
| `PG_SSL_REJECT_UNAUTHORIZED` | `true` | Certificate validation policy when explicit TLS is applied |

`DEFAULT_MAX_DISTANCE_METERS` must not exceed `MAX_MAX_DISTANCE_METERS`. Blank radius settings are invalid. There is no fallback database credential. Direct Node execution requires `DATABASE_URL`; Compose continues to construct it from the existing generated password. Invalid connection configuration fails before opening a pool or listener, with a message that does not print the supplied URI.

## Swagger rules

Username and password must be set together, even when Swagger is disabled. Both are mandatory when Swagger is enabled outside development. In development, setting the pair also requires documentation login.

`SWAGGER_TRY_IT_OUT_ENABLED=false` disables UI execution without changing access to direct HTTP requests. `BASE_URL` does not move Express routes. A reverse proxy that adds a prefix must configure routing separately.

## Compose settings

| Setting | Source and behavior |
| --- | --- |
| `POSTGRES_PASSWORD` | Required in `.env`; generated as 64 hexadecimal characters; used by PostGIS and to construct the application's `DATABASE_URL` |
| `SWAGGER_AUTH_PASSWORD` | Required in `.env`; generated independently as 48 hexadecimal characters |
| `SWAGGER_AUTH_USERNAME` | `docs_operator` in the template and Compose fallback |
| `SWAGGER_ENABLED` | `true` in the template and Compose fallback; credentials remain required by this deployment |
| `SWAGGER_TRY_IT_OUT_ENABLED` | `true` in the template and Compose fallback |
| `PORT` | `8080`; the same host/container port, published only at `127.0.0.1` |
| `BASE_URL` | `/`; OpenAPI server URL, not Express route mounting |
| Other settings in `.env.example` | Explicitly forwarded to the application with the defaults shown above |
| `NODE_ENV`, `TZ` | Fixed to `production` and `UTC` by Compose |
| `DATABASE_URL` | Constructed inside Compose as `postgresql://nearby:<POSTGRES_PASSWORD>@postgres:5432/nearby`; a host variable with this name does not override it |
| `PG_SSL` | Fixed to `false` for this local Docker database connection |
| Project and storage | Project `nearby-vm`, volume key `pgdata`, default volume name `nearby-vm_pgdata` |

The only distributed environment template is `.env.example`. Its passwords are empty, so copying it without initialization fails Compose's required-value validation. The initializer writes `.env` with mode `0600` in the project root, regardless of the caller's working directory. It builds the file privately and publishes it atomically without replacing files, directories or symlinks. A failed attempt cleans up its temporary file. It requires a Linux host with GNU coreutils, a POSIX shell and OpenSSL.

Keep database passwords hexadecimal for URL interpolation. Changing `POSTGRES_PASSWORD` in `.env` does not rotate an initialized PostgreSQL role's stored password; coordinate SQL password rotation and container configuration. Preserve the existing file and volume across releases. For an earlier VM package using `.env.vm`, follow the one-time rename in [Ubuntu VM deployment](VM_UBUNTU.md).

The source ZIP, Git ignore rules and Docker build ignore rules exclude real environment files. Docker administrators can inspect container environments; restrict host and Docker access. For optional direct Node execution, supply `DATABASE_URL` for a separately reachable database as described in [Deployment](DEPLOYMENT.md); the VM's PostGIS port is not published.

## TLS and migrations

With `PG_SSL=true`, the application gets `rejectUnauthorized` from the corresponding variable. The migration wrapper forwards that policy to its CLI. An explicit `--reject-unauthorized` migration argument takes precedence over the wrapper setting. The driver also interprets TLS options in the connection URL; keep URL and environment settings consistent.

`PG_SSL=false` means the application adds no explicit TLS option. It does not guarantee a non-TLS connection if the URL or driver environment enables TLS.

## Tool variables

| Variable | Tool | Default or rule |
| --- | --- | --- |
| `INTEGRATION_DATABASE_URL` | PostGIS tests | Unset skips the suite; otherwise use a dedicated disposable database |
| `SWAGGER_DOM_TESTS` | Optional Swagger tests | Only `true` enables DOM interaction tests; requires the separate jsdom QA installation in [Testing](TESTING.md) |
| `BENCHMARK_LAT` | Benchmark | `35.6892`; latitude rules |
| `BENCHMARK_LNG` | Benchmark | `51.389`; longitude rules |
| `BENCHMARK_RADIUS_METERS` | Benchmark | `5000`; application radius rules |
| `BENCHMARK_PAGE` | Benchmark | `1`; page rules |
| `BENCHMARK_PAGE_SIZE` | Benchmark | `10`; pageSize rules |
| `BENCHMARK_ITERATIONS` | Benchmark | `30`; integer 5-10000 |
| `BENCHMARK_EXCLUDE_USER_ID` | Benchmark | Unset; identifier rules |
| `BENCHMARK_EXPLAIN` | Benchmark | Only the exact value `true` includes query plans |

Real integration tests delete `locations` data. The benchmark uses a read-only transaction. See [Testing](TESTING.md) and [Performance](PERFORMANCE.md).
