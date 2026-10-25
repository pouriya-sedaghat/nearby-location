# Testing, benchmarks, and operational tooling

[Documentation index](README.md) · [Development](DEVELOPMENT.md) · [Operations](OPERATIONS.md)

## Validation levels

| Level | What it establishes | What it does not establish |
|---|---|---|
| Type/build and script checks | Type correctness and supported script syntax | Real database/network behavior |
| Unit/HTTP/tooling tests | Ranking, cursor/auth, validation, admission, lifecycle, response and tool regressions | Representative production throughput |
| PostGIS integration | Real migrations, writes/searches/cleanup and SQL-equivalence behavior | Target database sizing/failover |
| Production-image VM smoke | Container wiring, auth, coordinates, cursor traversal, erasure, restart/persistence | HA or backup recovery |
| Workload and query-plan measurement | Performance for a stated dataset/environment | Universal RPS or latency guarantees |
| Environment acceptance | Transport, access, recovery, monitoring, migration and rollout evidence | Future releases without revalidation |

## Local correctness checks

```bash
npm ci --ignore-scripts
npm run typecheck
npm run check:scripts
npm run migrations:check
npm run test:unit
NODE_ENV=test npm run docs:api
git diff --exit-code -- docs/openapi.json
```

`test:unit` builds first and covers unit tests plus HTTP, lifecycle, security manifests, VM/release helpers, Swagger, and source packaging. Host Python 3 and Bash are required for those tooling tests. `npm test` also discovers the integration test file, but that file **skips** without `INTEGRATION_DATABASE_URL`; a green unconfigured `npm test` is not proof of real PostGIS coverage.

Monitoring-rule validation requires `promtool` or Docker:

```bash
npm run check:monitoring -- --docker
```

Without Docker, install/use a compatible promtool and run `npm run check:monitoring`; `PROMTOOL_BIN` can identify its executable.

## Real PostGIS integration

Use a dedicated disposable database. The integration suite migrates it and **truncates `locations` before tests and at completion**. Never supply a production/shared user-data database.

For example, start a separate container on a free local port:

```bash
docker run -d --name nearby-test-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nearby_test \
  -p 127.0.0.1:5433:5432 postgis/postgis:16-3.4
docker exec nearby-test-db pg_isready -U postgres -d nearby_test
```

Wait for readiness, then:

```bash
INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/nearby_test \
  npm run test:integration
```

Coverage includes current-row upsert, exact/normalized erasure, radius/exclusion, TTL, stored coordinates, counts, deterministic cursors, cleanup and SQL equivalence fixtures. The rolling-erasure test uses a captured legacy privacy-contract fixture against the same disposable database, rather than fetching a commit from another repository. It verifies 404/no deletion on the legacy exact path and byte-exact deletion here. This is a contract compatibility check, not execution of an old full service binary. See [integration cases](../tests/location.integration.test.js) and the [legacy contract fixture](../tests/fixtures/legacy-privacy-contract.js).

## CI behavior

The [CI workflow](../.github/workflows/ci.yml) runs on pull requests and pushes to `main`. It installs Node 24 dependencies, audits them, checks migration policy/types/scripts/monitoring, verifies generated OpenAPI, runs unit/tooling tests, packages source, runs real PostGIS integration, builds the production image, and executes the isolated VM profile for smoke, seed, query plans, resource capture, and restart/persistence.

Inspect the workflow result for the exact revision under review. Earlier counts, benchmark reports, or green runs do not establish current CI or target-environment acceptance. The [release workflow](../.github/workflows/release-canary.yml) is a separate manually dispatched cluster action.

## Synthetic datasets

Configure `BENCHMARK_SEED_DATABASE_URL` to an isolated benchmark database, migrate it, then seed:

```bash
NODE_ENV=test BENCHMARK_SEED_COUNT=10000 \
  BENCHMARK_SEED_RADIUS_METERS=10000 \
  BENCHMARK_SEED_FRESHNESS_DAYS=1 \
  BENCHMARK_SEED_USER_PREFIX=bench_ \
  npm run benchmark:seed
```

Defaults are 100,000 users, batches of 25,000, a 100 km radius, and seven-day freshness around latitude 35.6892/longitude 51.389. The seed updates existing generated IDs with that prefix and normally runs `ANALYZE`. It modifies the database even when truncation is disabled.

`BENCHMARK_SEED_TRUNCATE=true` additionally requires `BENCHMARK_SEED_CONFIRM=TRUNCATE_LOCATIONS`; both are destructive and belong only on disposable data. `BENCHMARK_SEED_ANALYZE=false` skips analysis. Record actual row count, age distribution, density, and radius through `inspect:db` rather than assuming the requested count defines the complete table.

## HTTP benchmarks

Run the API against the isolated benchmark dataset. Set `BENCHMARK_AUTH_TOKEN` from the target's location token; these HTTP tools read process environment and do not automatically load the application's `.env` files.

```bash
BENCHMARK_BASE_URL=http://127.0.0.1:8080 \
  BENCHMARK_REQUEST_MODE=cursor_first \
  BENCHMARK_CONCURRENCY=10 \
  BENCHMARK_DURATION_SECONDS=30 \
  BENCHMARK_MAX_DISTANCE_METERS=10000 \
  npm run benchmark:http
```

| Mode | Request pattern |
|---|---|
| `offset_first` | First offset page |
| `offset_deep` | Deep offset page; default `BENCHMARK_PAGE=1000` |
| `cursor_first` | First cursor page, including initial count |
| `cursor_next` | Repeated continuation with one bootstrapped first-page cursor; requires enough eligible rows |

| Key control | Default |
|---|---|
| `BENCHMARK_BASE_URL` | `http://127.0.0.1:8080` |
| `BENCHMARK_REQUEST_MODE` | `offset_first` unless legacy pagination override is supplied |
| `BENCHMARK_CONCURRENCY` | 20, maximum 2,000 |
| `BENCHMARK_DURATION_SECONDS` | 15, maximum 3,600 |
| `BENCHMARK_WARMUP_SECONDS` | 2 |
| `BENCHMARK_REQUEST_TIMEOUT_MS` | 5,000 |
| `BENCHMARK_LAT`, `BENCHMARK_LNG` | 35.6892, 51.389 |
| `BENCHMARK_MAX_DISTANCE_METERS` | 10,000; must also fit the target API cap |
| `BENCHMARK_PAGE_SIZE` | 20 |
| `BENCHMARK_EXCLUDE_USER_ID` | Omitted |
| `BENCHMARK_AUTH_TOKEN` | Omitted; required by a protected target |
| `BENCHMARK_MAX_ERROR_RATE` | 0 |
| `BENCHMARK_MAX_P95_MS`, `BENCHMARK_MAX_P99_MS`, `BENCHMARK_MIN_RPS` | No absolute budget unless supplied |

Output reports latency, throughput, statuses, controlled rejection reasons, whether the bootstrapped cursor was signed, and budget verdicts. `cursor_next` measures repeated next-page queries, not a complete traversal of the population. Configure acceptance budgets before measuring. Distinguish accepted responses, controlled shedding, network failures, and useful throughput. Tool exit 2 indicates an evaluated budget/gate failure; exit 1 generally indicates configuration/execution failure. See [the benchmark implementation](../scripts/benchmark-http.js).

## Query-plan analysis

Use a configured isolated/staging database and the same ranking/TTL settings as the API:

```bash
NODE_ENV=test EXPLAIN_QUERY_MODE=cursor_first EXPLAIN_OUTPUT=json \
  EXPLAIN_MAX_DISTANCE_METERS=10000 npm run analyze:nearby
NODE_ENV=test EXPLAIN_QUERY_MODE=cursor_next EXPLAIN_OUTPUT=json \
  EXPLAIN_MAX_DISTANCE_METERS=10000 npm run analyze:nearby
```

Modes are `ranking_probe` (default), `cursor_first`, and `cursor_next`. Cursor modes share the application's query builder; `ranking_probe` is diagnostic SQL. `EXPLAIN_LAT`, `EXPLAIN_LNG`, `EXPLAIN_LIMIT`, `EXPLAIN_INCLUDE_PLAN`, `EXPLAIN_REQUIRE_GIST_INDEX`, and `EXPLAIN_MAX_EXECUTION_MS` customize analysis/output/gates.

`EXPLAIN ANALYZE` actually executes read queries and consumes database resources. Full plans can contain SQL constants/search details; handle them as internal evidence. Index use depends on selectivity, and a sequential scan is not automatically a defect. Require GiST use only for workload cases where the accepted plan should use it.

## Ranking comparison

```bash
NODE_ENV=test COMPARE_LAT=35.6892 COMPARE_LNG=51.389 \
  COMPARE_MAX_DISTANCE_METERS=10000 COMPARE_LIMIT=20 \
  npm run compare:ranking
```

This read tool compares legacy/decay rank changes for a shared candidate set. Output includes user identifiers and update information; use synthetic data or access-controlled evidence. It does not switch the serving API. Evaluate relevance as well as performance before a profile change, and plan decay cursor invalidation.

## Benchmark matrix

Against an existing synthetic dataset:

```bash
BENCHMARK_MATRIX_MODES=cursor_first,cursor_next,offset_first,offset_deep \
  BENCHMARK_MATRIX_RADII_METERS=1000,10000 \
  BENCHMARK_MATRIX_CONCURRENCIES=1,5,20 \
  BENCHMARK_MATRIX_DURATION_SECONDS=15 \
  npm run benchmark:matrix
```

The matrix writes JSON and Markdown under `benchmark-results/` by default (`BENCHMARK_MATRIX_OUTPUT_DIR` and `BENCHMARK_MATRIX_OUTPUT_NAME` override this). It can inspect the database and run plans when `BENCHMARK_MATRIX_INSPECT_DB=true` / `BENCHMARK_MATRIX_RUN_EXPLAIN=true` with matching DB settings.

Optional seeding requires both `BENCHMARK_MATRIX_SEED=true` and strictly increasing `BENCHMARK_MATRIX_DATASET_SIZES`. Truncation additionally needs `BENCHMARK_MATRIX_TRUNCATE=true` and `BENCHMARK_MATRIX_CONFIRM=TRUNCATE_LOCATIONS`. Match the seeding database to the running API; the matrix does not restart the API or change its ranking configuration for you.

Matrix-specific budgets are `BENCHMARK_MATRIX_MAX_ERROR_RATE`, `BENCHMARK_MATRIX_MAX_P95_MS`, `BENCHMARK_MATRIX_MAX_P99_MS`, `BENCHMARK_MATRIX_MIN_RPS`, plus plan gates `BENCHMARK_MATRIX_REQUIRE_GIST_INDEX` and `BENCHMARK_MATRIX_MAX_EXPLAIN_MS`. Choose them from your acceptance goals.

## Canary comparison

Configure distinct stable/candidate URLs and a location credential accepted by both:

```bash
CANARY_STABLE_BASE_URL=http://stable.example.internal \
  CANARY_CANDIDATE_BASE_URL=http://candidate.example.internal \
  BENCHMARK_REQUEST_MODE=cursor_first CANARY_ROUNDS=3 \
  npm run canary:compare
```

The tool alternates repeated benchmark runs and evaluates candidate absolute/error/rejection limits plus relative latency/throughput. Its default request mode inherits the benchmark default (`offset_first`); the Kubernetes release script sets `cursor_first` explicitly.

| Gate variable | Default |
|---|---|
| `CANARY_MAX_ERROR_RATE` | 0.01 |
| `CANARY_MAX_ERROR_RATE_DELTA` | 0.005 |
| `CANARY_MAX_REJECTION_RATE` | 0.02 |
| `CANARY_MAX_REJECTION_RATE_DELTA` | 0.01 |
| `CANARY_MAX_P95_RATIO` | 1.25 |
| `CANARY_MAX_P99_RATIO` | 1.35 |
| `CANARY_MIN_RPS_RATIO` | 0.8 |

Ratios compare candidate with stable; rate deltas are absolute fraction differences. `CANARY_OUTPUT_FILE` saves the report, and `CANARY_INCLUDE_RAW_RUNS=true` adds raw rounds. A failed gate returns exit 2. Synthetic comparison does not replace live observation or operator judgment. See [release orchestration](../deploy/kubernetes/release/README.md).

## Command index

| npm script | Purpose |
|---|---|
| `dev`, `build`, `start`, `typecheck` | Watch, compile, execute, validate types |
| `test`, `test:unit`, `test:integration` | All-discovered, unit/HTTP/tooling, real DB tests |
| `migrate:up`, `migrate:down`, `migrate:create` | Migration CLI; down can be destructive |
| `migrations:check` | Compatibility policy on migration `up` operations |
| `analyze:nearby` | Read-query EXPLAIN analysis |
| `compare:ranking` | Legacy/decay ordering comparison |
| `benchmark:seed` | Synthetic writes to a disposable dataset |
| `benchmark:http`, `benchmark:matrix` | HTTP workloads and repeated scenario reports |
| `canary:compare` | Stable/candidate comparison gate |
| `capacity:check` | Database connection budget |
| `inspect:db` | Aggregate table/index/connection diagnostics |
| `privacy:audit` | Aggregate retention/future-timestamp gate |
| `docs:api` | Build and export OpenAPI |
| `check:scripts` | Operational JavaScript syntax |
| `check:monitoring` | Prometheus rules and synthetic rule tests |
| `release:source` | Deterministic source ZIP through Python |

`scripts/smoke-http.js` and the VM wrapper are invoked directly; they are not npm script names. Database tools load only `.env`; HTTP benchmark/matrix/canary tools use supplied process variables. Review [package.json](../package.json) and each script for exhaustive controls.

## Record evidence

For each acceptance run, preserve date, commit/working-tree state, image digest, runtime/database versions, machine resources, replicas/pool/config profile, dataset count/density/freshness, coordinate/radius/page settings, client location, warmup/duration/concurrency, budgets, accepted RPS, success-path p95/p99, statuses/rejection reasons, pool/DB/resource graphs, plans, and pass/fail outcome.

Tie migration rehearsal, restart/failover, backup restoration, credential rotation, and canary rollback evidence to the same release/environment. Use the [production gate table](PRODUCTION_READINESS.md) to record ownership and acceptance rather than transferring historical benchmark numbers into current claims.


## Bilingual and Swagger DOM regression checks

The standard suite includes request-local English/Persian negotiation, immutable request-start age, malformed UTF-8/UTF-16 protection, privacy/cursor/authentication messages and concurrent-language isolation. The release also covers explicit UTF-16 identifier bounds, finite metric labels, private Compose compatibility and owned cleanup/startup cancellation.

Optional DOM checks execute the bundled Swagger scripts without adding jsdom to the service graph. Install the QA tool in a sibling directory, then run from the project root:

```bash
npm install --ignore-scripts --prefix ../nearby-swagger-dom-tools --no-save --package-lock=false jsdom@30.1.3
npm run build
NODE_PATH="$(pwd)/../nearby-swagger-dom-tools/node_modules" SWAGGER_DOM_TESTS=true node --test tests/swagger.dom.test.js
```

These checks verify live Execute, named examples, language input, localized results, snippets, duration, filtering and the explicit read-only override. They do not establish Chrome/Firefox layout quality or real database execution. See [Release review](RELEASE_REVIEW.md) for the executed release snapshot.
