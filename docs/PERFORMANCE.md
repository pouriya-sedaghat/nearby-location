# Performance and measurement

[Documentation index](../README.md)

## Search query structure

The model query constructs the search center, materializes candidates, and materializes the requested page.

| Stage | Work |
| --- | --- |
| `params` | Convert center `lng, lat` to geography |
| `candidates AS MATERIALIZED` | Radius/TTL/exclusion filters and one explicit `ST_Distance` calculation per candidate |
| `paged AS MATERIALIZED` | Score, `COUNT(*) OVER()`, ordering, OFFSET, LIMIT |
| Outer SELECT | Extract `ST_Y/ST_X` only for selected page rows |
| Count fallback | Count candidates for an empty page with a positive offset |

`ST_DWithin` allows spatial index use; PostgreSQL chooses the actual plan. Geography distance uses the spheroid by default and is measured in meters. See [API reference](API.md) for score/identifier ordering.

"One distance calculation" refers to the explicit `ST_Distance` projection. Radius filtering also performs computational work. Materialization does not guarantee capacity or reduced latency for every dataset.

Full counts must inspect all candidates. Large radii and dense areas increase calculation and sorting work. Deep offsets still require sorting and skipping rows. Materialization can use memory or temporary files.

## Included benchmark

`scripts/benchmark-nearby.js` compares the current query with the SQL fixture at `scripts/fixtures/nearby-baseline.sql`. The fixture is a frozen comparison query; the application version remains `1.0.0`.

The tool opens a repeatable-read, read-only transaction, checks shared output fields for equivalence, warms each query five times, then alternates measurement order. It does not seed, delete, or truncate data, but repeated queries impose read load.

Example against a populated test database:

```bash
npm run build
NODE_ENV=production \
DATABASE_URL='postgresql://benchmark_user:replace-password@127.0.0.1:5432/nearby_benchmark' \
BENCHMARK_LAT=35.6892 \
BENCHMARK_LNG=51.389 \
BENCHMARK_RADIUS_METERS=5000 \
BENCHMARK_PAGE=1 \
BENCHMARK_PAGE_SIZE=10 \
BENCHMARK_ITERATIONS=30 \
BENCHMARK_EXPLAIN=true \
node scripts/benchmark-nearby.js > nearby-benchmark.json
```

Use the direct Node command when redirecting JSON; npm also writes a command banner to stdout. Variables and constraints are listed in [Configuration](CONFIGURATION.md).

## Reading the output

| Field | Meaning |
| --- | --- |
| `version` | Application version |
| `database` | PostgreSQL and PostGIS versions |
| `jit` | Session JIT setting |
| `input` | Effective schema-validated input |
| `equivalent` | Shared output fields matched |
| `page_rows` | Rows in the returned page |
| `total_count` | First row's window count; null on an empty page |
| `supplied`, `optimized` | Samples, mean, p50, and p95 latency in milliseconds |
| `plans` | Query plans and buffers, included only with EXPLAIN |

An empty benchmark page does not execute the model's count fallback; real model tests cover it separately. `optimized` is the tool's label for the current query, not a promise that it is always faster.

This is sequential SQL timing on one snapshot. It does not measure HTTP overhead, concurrency capacity, or maximum service traffic. Record hardware, database settings, data size/distribution, TTL, cache conditions, inputs, sample count, and timeout with comparisons.

## Plans and timeouts

The tool's EXPLAIN uses ANALYZE and actually executes each query. Inspect candidate counts, sorting, temporary I/O, and index plans on a test database. Do not substitute a higher `PG_STATEMENT_TIMEOUT_MS` for understanding slow queries.

JIT is a database/session setting with no dedicated application variable. The report records the session value. This package changes no global JIT or operating capacity setting.

## Technical references

- [PostGIS: ST_DWithin](https://postgis.net/docs/ST_DWithin.html)
- [PostGIS: ST_Distance](https://postgis.net/docs/ST_Distance.html)
- [PostgreSQL 16: WITH materialization](https://www.postgresql.org/docs/16/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION)

[Package validation](VALIDATION.md) identifies which performance checks were executed for this package.
