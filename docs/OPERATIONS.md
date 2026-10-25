# Operations guide

[Documentation index](README.md) · [Configuration](CONFIGURATION.md) · [Service incident runbook](runbooks/SERVICE_INCIDENT.md)

## Establish an operating baseline

Record the deployed commit/image, configuration revision, database identity, runtime/replica sizing, accepted load, retention, and incident owner. Capture a baseline for request mix, accepted RPS, end-to-end p95/p99, error/rejection rates, DB-operation latency, pool waiters, resource use, and cleanup outcomes. Synthetic test results must carry their dataset and environment assumptions.

Treat controlled 429/503 shedding as a capacity signal. A fast rejection should not improve the reported success-path latency at the expense of useful throughput.

## Probes and lifecycle

| Probe | Purpose | Operating interpretation |
|---|---|---|
| `/health/live` | HTTP process responsiveness | Database outages should not require automatic liveness restart loops |
| `/health/ready` | Lifecycle is ready and `SELECT 1` succeeds | Stops routing during drain/DB failure; does not validate schema or load capacity |

The Kubernetes startup probe waits for the listener, which starts only after database connection succeeds. Readiness includes the reported circuit state, but a successful readiness check does not require the circuit to be closed. Confirm an authenticated nearby request to validate the table/query path.

On termination, readiness changes before the routing drain delay. Budget the platform's grace beyond application shutdown plus preStop. Kubernetes examples use 40 seconds, a five-second preStop, and a 25-second application deadline. Check endpoint/ingress propagation in your environment.

## Logs and request IDs

Logs are JSON with timestamp, level, service, environment, event message, and selected fields. `http_request` records request ID, normalized route, method, status, and duration. Health/metrics requests are measured but omitted from normal request log lines. Use random correlation IDs; do not encode a user ID into them.

Production error serialization keeps safe error name/code and omits raw messages/stacks. Sensitive field names are recursively redacted. Development diagnostic errors can contain more detail, so use synthetic data. Gateway, database, APM, and support tooling need their own redaction rules; application sanitization does not protect those systems automatically.

Useful events include `service_started`, `postgres_connection_attempt_failed`, `request_admission_rejected`, `find_nearby_failed`, `upsert_location_failed`, `cleanup_completed`, `cleanup_failed`, and `shutdown_grace_period_exceeded`. Correlate aggregate metrics with events rather than collecting request bodies.

## Metrics and alerts

Metrics are exposed at `/metrics` as Prometheus text. Configure `METRICS_AUTH_MODE=bearer` and scraper credentials together, or restrict access through an equivalent network boundary. Each replica has its own in-memory counters/gauges; restarts reset local state, and aggregation belongs to monitoring.

| Metric family | Use |
|---|---|
| `nearby_http_requests_total` | Status/route request rates; distinguish 400/401, 429, and 5xx |
| `nearby_http_request_duration_seconds` | End-to-end latency histograms; inspect successful responses separately |
| `nearby_db_operation_duration_seconds` | DB-operation histograms by workload/outcome |
| `nearby_searches_total`, `nearby_search_results_total` | Pagination/ranking traffic and result volume |
| `nearby_admission_rejections_total` | Controlled rejection reason/workload |
| `nearby_rate_limit_rejections_total` | Local rate-limit pressure |
| `nearby_admission_circuit_state` | 0 closed, 1 half-open, 2 open |
| `nearby_admission_in_flight`, `nearby_admission_effective_limit` | Current workload/capacity per process |
| `nearby_admission_utilization_ratio` | Current in-flight work divided by effective cap |
| `nearby_admission_adaptive_adjustments_total` | Adaptive increase/decrease reasons |
| `nearby_admission_db_latency_ewma_milliseconds` | Smoothed latency driving adaptive control |
| `nearby_pg_pool_total_connections`, `nearby_pg_pool_idle_connections`, `nearby_pg_pool_waiting_requests` | Pool saturation and wait pressure |
| `nearby_pg_pool_utilization_ratio` | Active pool connections divided by configured pool max |
| `nearby_cursor_validation_failures_total`, `nearby_auth_failures_total` | Integration, clock, profile, or credential failures |
| `nearby_cleanup_runs_total`, `nearby_cleanup_deleted_total`, `nearby_cleanup_batches_total` | Cleanup outcomes and throughput |
| `nearby_privacy_location_deletions_total` | Internal erasure outcomes without user labels |
| `nearby_lifecycle_state`, `nearby_lifecycle_active_requests` | Drain/termination state and active work |
| `nearby_db_errors_total` | Observed database failures |

Example successful-nearby p95 query:

```promql
histogram_quantile(0.95,
  sum by (le) (rate(nearby_http_request_duration_seconds_bucket{
    route="/location/nearby", status="200"
  }[5m]))
)
```

Example admission rejection rate:

```promql
sum(rate(nearby_admission_rejections_total[5m]))
```

The [PrometheusRule example](../deploy/kubernetes/prometheus-rule.example.yaml) includes recording rules, error-budget burn alerts, and pressure/latency alerts. Its 5xx availability definition includes shed 503s; 429s need separate visibility. Tune target, windows, labels, receiver, and latency thresholds to your SLO. The example nearby p95 rule aggregates route latency across statuses, so also examine accepted-request latency during shedding. Validate the rules with `npm run check:monitoring -- --docker` where Docker is available.

## Connection capacity

The [capacity tool](../scripts/check-capacity.js) reads PostgreSQL limits and calculates:

```text
usable = max_connections - superuser_reserved_connections - reserved_connections
service_budget = max(0, floor(usable * utilization_percent / 100) - external_reserve)
configured_connections = expected_replica_pools * PG_POOL_MAX
pass when configured_connections <= service_budget
```

Default utilization is 70%; default external reserve is 20. Use the same `PG_POOL_MAX` as the deployed API. Set expected pools to maximum stable replicas plus rollout surge plus canary; separately reserve room for terminating pods and non-API clients. Cleanup uses the API pool and can hold one slot for a run; standalone Jobs/tools create additional connections.

For the example HPA maximum of six, surge of one, and one canary:

```bash
NODE_ENV=production CAPACITY_EXPECTED_REPLICAS=8 PG_POOL_MAX=10 \
  npm run capacity:check
```

This checks connection budget, not query throughput, CPU, I/O, lock contention, or failover. Recheck after any pool/replica/database limit change. HPA cannot create database capacity.

## Read-only database and retention checks

With the target database/transport configured securely:

```bash
NODE_ENV=production npm run inspect:db
NODE_ENV=production npm run privacy:audit
```

Inspection reports aggregate database/table/index/connection information. Retention audit reports stale/overdue/future timestamp counts and policy verdicts. Schedule audits with reviewed thresholds and alert on failures; it does not perform deletion. For physical cleanup lag, inspect advisory-lock skips, timeout/errors, batch caps, cron timezone, and database pressure. Do not respond by exposing raw location rows in logs.

## Rolling out exact erasure

`POST /privacy/location/delete-exact` exists only in builds that include it. The pre-fix 2.13.5 build at `014d80e` returns **404 and deletes nothing** for that path; version 2.14.0 includes it. Identify deployed capability by version and commit/image digest. The separate path fails closed on a replica without it, including during rollback.

- Never send a selector such as `match` to `POST /privacy/location/delete`. The pre-fix build drops unknown fields and applies normalized deletion (for example `" padded"` → `"padded"`); the current build rejects `match` with 400.
- The erasure workflow must treat any 404 from `delete-exact` as "not performed", keep the request queued, and retry with backoff and a deadline. It must not convert the request to the normalized route or record it as completed.
- Exact erasures stall until a supporting replica serves them. Alert on sustained failures in the erasure workflow and gateway telemetry. The current build labels the path `/privacy/location/delete-exact`, but the pre-fix build labels its 404 as `/not_found`; an alert filtering only the new route misses old replicas. Use workflow/gateway records to identify those requests without logging their bodies.
- Gateways, service meshes, and WAFs that allow-list paths must admit `/privacy/location/delete-exact` with the same privacy-caller restrictions as `/privacy/location/delete`. Until then, the gateway's own 404 is also "not performed".
- Normalized erasure preserves trimming for valid identifiers. Requests with ill-formed Unicode or a `match` field now return 400; correct those callers before upgrading.

During mixed deployments, an old replica also rejects cursors longer than 2,048 characters, while the current build accepts up to 2,400. Such cursors can occur for legacy stored identifiers with escaped control characters. Restart traversal after a 400; a successful long-cursor continuation requires a supporting replica. See [cursor traversal](API.md#cursor-traversal).

## Credential and cursor-key rotation

Use the primary/previous pairs for location, metrics, privacy, and cursor keys. Configuration is loaded once; updating the file/Secret requires a rollout.

For planned bearer-token rotation:

1. Provision the new primary token while accepting the old token in the previous slot on every serving replica.
2. Move callers/scrapers to the new primary after rollout completes.
3. Confirm failures and traffic, then remove the previous token and roll again.

For cursor keys, replicas must verify keys used by other replicas throughout the rollout. First add the future key as the previous accepted key while retaining the old primary everywhere. Then swap to new primary/old previous and roll. After the longest accepted cursor session and rollout overlap have expired, remove the old key. Legacy v1 sessions lack the v3 issuance bound, so review compatibility requirements before relying only on the v3 lifetime.

If starting from unsigned cursors, distribute the signing key first, allow the required legacy transition, then require signatures fleet-wide. New unsigned v3 tokens become invalid once signing is configured. In a compromise, revoke the compromised value promptly and accept disrupted callers/cursor sessions rather than maintaining a compromised overlap window.

## Troubleshooting

| Symptom | Evidence / cause | Response |
|---|---|---|
| Startup exits with invalid configuration | Setting name and validation message | Correct values and cross-setting constraints; restart |
| DB TLS conflict | URL TLS parameters plus `PG_SSL=true` | Choose one TLS owner; retain certificate verification |
| Readiness succeeds, search returns 500 | Missing schema/permissions or non-retryable SQL issue | Inspect migration/grants and error code; test the real query |
| 401 after deploy | Incorrect surface token or incomplete rollout | Compare caller and primary/previous configuration without printing secrets |
| 400 cursor failures | Expiry, altered query, key/profile mismatch, skew | Restart traversal; inspect fleet settings and clocks |
| 429 | Local IP/workload limiter | Honor retry delay; verify proxy trust and gateway quota |
| 503 `concurrency` / `pool_queue` | Admission/pool saturation | Inspect workload and DB plan/capacity before raising limits |
| 503 `circuit_open` / `db_retryable` | DB availability or transient query error | Follow DB incident procedure; bound retries |
| API behind proxy sees all clients as one IP | Direct socket IP used or uncontrolled proxy headers | Define trusted ingress and decide `HTTP_TRUST_PROXY` safely |
| Cleanup repeatedly partial/failed | Run cap, timeouts, locks, or insufficient schedule throughput | Tune maintenance with aggregate evidence; TTL reads still filter |
| Swagger 404 or 401 | Disabled routes or docs credentials | Check independent switches and Basic auth |
| Secret update does not take effect | Process env snapshot unchanged | Perform a controlled restart/rollout |
| Release blocked by lock | Active or orphaned namespace lock | Verify owner/process/Jobs before removing a stale lock |
| Rollback appears complete but errors persist | External config/schema/network change | Restore compatible settings and verify live SQL path |

For outages use [service incident response](runbooks/SERVICE_INCIDENT.md); for restore use [backup/restore](runbooks/BACKUP_RESTORE.md); for data exposure use [privacy incident](runbooks/LOCATION_PRIVACY_INCIDENT.md).
