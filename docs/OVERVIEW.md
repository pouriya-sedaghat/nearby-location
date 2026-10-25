# Service overview

[Documentation index](README.md) · [Architecture](ARCHITECTURE.md) · [API](API.md)

## Purpose

Nearby Location provides a shared location capability for an application that needs to discover users near a geographic point. A trusted caller publishes a user's location, then searches around a WGS84 coordinate. Results include the matched user's current coordinate, distance in meters, and update time.

The database stores one current row per user. A new publication replaces that row's position and refreshes its timestamp. The service does not keep a movement history or accept a device-supplied observation time; freshness begins when PostgreSQL handles the upsert.

Example: a caller publishes a participant's position, then asks for fresh participants within 5,000 meters of a meeting point while excluding the requesting user. The service selects eligible rows, ranks them, and returns a bounded page. The caller decides which participants may be visible.

## Capabilities and boundaries

| Capability | Implemented behavior | Boundary |
|---|---|---|
| Location publication | Atomic upsert by unique `user_id` | Caller validates identity, consent, and permission to publish |
| Nearby discovery | Inclusive PostGIS radius, TTL filter, optional one-user exclusion | No tenant, friendship, visibility, or consent filter in the query |
| Result enrichment | Stored coordinate, meter distance, ISO timestamp, English or Persian relative age | Exact positions must be authorized before disclosure |
| Ranking | Global `legacy` or configurable `decay` profile | A caller cannot select a different ranking mode per request |
| Pagination | Offset pages or query-bound keyset cursors | Live updates can change rows between requests |
| Cursor security | Optional HMAC-SHA256 signing, rotation, and age checks | Signing protects integrity; cursor payloads are not encrypted |
| Retention | Read-time exclusion plus startup/scheduled batched deletion | Physical deletion and backup expiry follow separate schedules |
| Privacy erasure | Optional authenticated idempotent hard-delete command | Upstream publishers and queues must be stopped first |
| Resilience | Local concurrency caps, pool pressure rejection, circuit breaker, optional adaptive limits | More API replicas still consume more database connections |
| Observability | Probes, JSON logs, request IDs, Prometheus text metrics | Platform monitoring and alert delivery are external |

No Redis, message broker, external geocoder, map UI, navigation engine, or location history store is required by this implementation.

## Operating modes

| Dimension | Choices | Application default | Selection guidance |
|---|---|---|---|
| Ranking | `legacy`, `decay` | `legacy` | Preserve ordering first; evaluate decay on representative data before switching |
| Pagination | `offset`, `cursor` | `offset` | Offset supports page numbers; cursors avoid deep offset traversal |
| Location identity | `disabled`, `bearer` | `disabled` | Enable bearer authentication or enforce an equivalent service boundary |
| Metrics identity | `disabled`, `bearer` | `disabled` | Restrict scraper access independently |
| Cursor integrity | Unsigned compatibility, signed, signatures required | Unsigned | Use shared signing keys and require signatures for production callers |
| Privacy API | Disabled, enabled with dedicated token | Disabled | Enable only for a controlled erasure workflow |
| Admission | Fixed limits; optional adaptive limits | Fixed enabled, adaptive disabled | Start with measured limits; adaptive changes are per process |
| Rate limit | Disabled, local fixed window by client IP/workload | Disabled | Global quotas require a trusted gateway or external coordinator |
| Swagger | Disabled, view-only, interactive | Interactive in development; disabled otherwise | Outside development, dedicated Basic credentials are mandatory |
| Runtime migration | Explicit CLI/Job; Docker entrypoint migration | Entrypoint enabled | Kubernetes uses a separate Job and disables per-pod startup migrations |

These are independent switches. For example, cursor pagination works with both ranking modes, and Swagger can be enabled independently of `NODE_ENV`. Deployment profiles override some defaults; see [configuration](CONFIGURATION.md#deployment-profile-differences).

## Typical workflows

**Publish:** authenticate the calling service → admit work → validate ID and coordinate → upsert the current position → return HTTP 200.

**Discover:** authenticate → admit work → validate search and cursor → select fresh candidates within radius → rank → page → serialize public fields. The public response excludes the internal ranking score.

**Erase:** stop upstream publication and pending retries → drain queued events → submit the privacy deletion command → track completion externally → enforce the same erasure during recovery.

**Operate:** build and identify a release → rehearse migrations → measure the workload → validate connection capacity → deploy → observe errors, rejections, latency, cleanup, and recovery. See [deployment](DEPLOYMENT.md), [testing](TESTING.md), and [production acceptance](PRODUCTION_READINESS.md).

## Limits to account for

- Ranking combines distance and freshness; ordering is not purely nearest-first.
- Signed cursor counts reflect the first page. They are not a live count on subsequent requests.
- Decay pins the scoring clock but does not create a database snapshot across pages.
- Authentication uses shared service tokens. It does not establish end-user ownership of `userId`.
- Cleanup needs database capacity and time; expired data can remain physically stored until a successful run.
- Readiness checks connectivity and lifecycle, not schema completeness or capacity under load.
- Kubernetes templates, VM evaluation, and green CI support validation; production acceptance belongs to the target environment.
