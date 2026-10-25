# Testing guide

[Documentation index](../README.md)

## Database-independent checks

From the project root:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run openapi:check
```

`npm test` builds the source and runs all `tests/*.test.js` files. Without `INTEGRATION_DATABASE_URL`, the real PostGIS suite is skipped. If that variable remains set from an earlier shell session, the general test command also runs database tests.

HTTP tests build explicit application instances with fake repository/health dependencies and temporary local listeners. No shared application module singleton or real database is modified. Their success does not demonstrate execution of PostGIS queries.

| Test file | Coverage |
| --- | --- |
| `config.test.js` | Required/sanitized database URI, explicit `.env` loading, process precedence, defaults, documentation credentials, radius, BASE_URL, cron, timeout bounds and Express mode |
| `db.test.js` | Connection retries, probe/acquisition cancellation, client release, TLS options and idempotent disposal |
| `location.http.test.js` | Location responses, radius, pagination, compressed JSON, strict UTF-8 bytes, valid Unicode/BOM/UTF-16, Unicode/NUL and Swagger |
| `language.http.test.js` | English/Persian negotiation, regions/quality weights/fallback, localized successes and errors, stable machine fields, request-start age, repeated requests, concurrent isolation and documentation language |
| `migration.test.js` | Single `.env` loading, process precedence and TLS policy forwarding |
| `openapi.test.js` | Routes, references, file consistency, source-free contract construction and export independent of local/runtime settings |
| `swagger.test.js` | OpenAPI validation, named examples, runtime radius consistency, authenticated production UI and execution of all four HTTP operations |
| `swagger.dom.test.js` | Optional real Swagger script/DOM interactions; disabled by default |
| `cleanup.test.js` | Overlap prevention, active-batch draining, stopped callbacks, scheduler failure and real task-registry removal |
| `server.test.js` | Child-process startup/listener failures, startup cancellation, repeated signals, HTTP/cleanup draining, failure status and the real entrypoint against an unavailable local database port |
| `timeAgo.test.js` | English/Persian native formatting, elapsed-unit boundaries, singular/plural text, UTC month/year anniversaries, leap centuries, invalid/future dates, explicit references and non-mutation |
| `location.controller.test.js` | One reference clock for an entire result page, exact timestamps retained and invalid stored timestamps handled as internal errors |
| `env-init.test.js` | Private credential generation, no partial files on failure, concurrency, project-root location, previous-credential protection, and file/symlink/directory refusal; requires Linux coreutils, POSIX shell and OpenSSL |
| `packaging.test.js` | Approved release paths, excluded local exports/credentials, symlink refusal and packaged checksums; requires Python 3 |
| `app.test.js` | Side-effect-free module imports and separate app limits, credentials, contract and UI execution flags |
| `location.model.test.js` | Typed mapping, coordinate/bind order, out-of-range counts, shared TTL and persistence-error propagation |
| `location.integration.test.js` | Repository behavior and plans on real PostGIS |

Most tests pass configuration directly to pure factories and do not read `.env`. File-loading tests use temporary directories, and executable tests use explicitly controlled process variables. Use a clean checkout and unset `INTEGRATION_DATABASE_URL` for a database-independent run.

## Optional Swagger DOM interaction tests

These tests use jsdom as an external QA tool without adding it to the service dependency graph. With Node.js 24, install the verified tool version in a sibling directory and run from the project root:

```bash
npm install --ignore-scripts --prefix ../nearby-swagger-dom-tools \
  --no-save --package-lock=false jsdom@30.1.3
npm run build
NODE_PATH="$(pwd)/../nearby-swagger-dom-tools/node_modules" \
  SWAGGER_DOM_TESTS=true node --test tests/swagger.dom.test.js
```

The interactive case loads the actual Swagger UI assets and live OpenAPI over HTTP, switches request examples, clicks Execute for all four operations, sets the Accept-Language input to Persian and verifies localized output, checks live responses and model calls, and verifies cURL snippets, timing, deep links and tag filtering. The second case verifies the explicit read-only override. The fixture runs its server and DOM in one process and uses only in-memory model/database stubs.

This is a DOM execution check, not Chrome/Firefox rendering, layout validation or real PostGIS integration. Without `SWAGGER_DOM_TESTS=true`, the optional suite is reported as skipped. Normal contract and HTTP tests always run. The service's normal runtime requirements are unchanged.

## Real PostGIS tests

**This suite truncates `locations` before tests and at completion, resetting IDs. Supply only a dedicated disposable database.** Suite startup also applies the existing migration.

Example temporary database:

```bash
docker run -d --name nearby-test-db \
  -p 127.0.0.1:55432:5432 \
  -e POSTGRES_PASSWORD=example \
  -e POSTGRES_DB=nearby_test \
  postgis/postgis:16-3.6-alpine

docker exec nearby-test-db pg_isready -U postgres -d nearby_test
```

After readiness succeeds:

```bash
INTEGRATION_DATABASE_URL='postgresql://postgres:example@127.0.0.1:55432/nearby_test' \
  npm run test:integration
```

The suite covers upsert uniqueness, radius/exclusion, TTL, out-of-range counts, zero and negative coordinates, points on either side of the radius boundary, SQL output equivalence, and real execution plans.

To remove this temporary database:

```bash
docker rm -f nearby-test-db
```

Use this command only for the test container created on this page.

## Contract checks and smoke tests

`npm run openapi:check` compares the canonical file against the code-generated contract. After an intentional contract definition change, regenerate it with `npm run openapi:export` and review the diff.

For deployment acceptance, use an authorized test environment and database:

1. Check liveness and readiness.
2. Upsert a test identifier.
3. Search at the same center and check distance/coordinates.
4. Exclude that identifier.
5. Send an invalid radius and verify 400.
6. Verify documentation login if enabled.

Runnable examples are in [Getting started](GETTING_STARTED.md) and [API reference](API.md). Benchmarks do not replace smoke tests or concurrency tests.

## Interpreting results

A skipped suite is not a successful database test. Passing unit/HTTP tests does not prove that an image builds or Compose starts. [Package validation](VALIDATION.md) records results and environment limitations for this package.
