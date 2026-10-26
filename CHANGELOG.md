# Changelog

The 2.14.0 entry describes the consolidated baseline; 2.14.1 is its reviewed routing/validation patch. Earlier 2.x entries retain the supplied archive's history and do not imply that corresponding GitHub tags exist in this repository. For current setup and operation, use the [documentation index](docs/README.md).

## 2.14.1 — 2026-10-26

- Move Swagger UI, JSON and assets to `/api/docs`; authenticate documentation before JSON parsing.
- Limit documentation resources to GET/HEAD and serve HTML only at the UI root. Unknown resources/unsupported methods return English JSON 404; the previous `/api-docs` route returns 404.
- Validate raw UTF-16 with matching BOM/byte order before JSON decoding, including malformed Unicode in ignored fields; retain valid BE/LE transports.
- Share strict, credential-safe PostgreSQL URI validation across server configuration, migration and database tools. Reject fragments, malformed percent-encoded UTF-8 and decoded NUL in every URI component.
- Prevent ambient PGSSLMODE from overriding explicit TLS switches while preserving documented URI-owned TLS when PG_SSL=false. Keep certificate verification policy consistent for migration/tool clients.
- Validate cron schedules and PostgreSQL retention integer bounds before startup. Add focused regressions, update runtime/deployment versions and current documentation. The initial migration and location/privacy API contracts are unchanged.

## 2.14.0 — 2026-10-25

- Integrate the supplied 2.13.5 source with the published 1.0.0 deployment and response-language contracts; retain the unchanged database migration and VM volume identity.
- Preserve English/Persian API messages, request-local language negotiation and dynamic ages using a single server request-start instant and UTC calendar months/years.
- Patch body-parser, fast-uri and Zod advisories; retain explicit UTF-16 identifier bounds through the Zod 4 upgrade. Disable dependency install hooks in Docker, CI and documented installs.
- Reject malformed UTF-8/UTF-16 bodies before they can alias identifiers, keep authorization before parsing, bound metric label cardinality and validate release-template inputs before cluster operations.
- Drain and dispose owned cleanup schedules, cancel database startup retries on termination and preserve nonzero shutdown failures.
- Replace route-source annotation scanning with one explicit, environment-independent OpenAPI contract, isolated Swagger UI options, editable language input and named request examples.
- Isolate the VM evaluation project/port from the existing production VM to prevent evaluation commands from replacing its containers.
- Restore private default Compose initialization and document upgrades from both source lines. Separate the disposable development profile and exclude local secrets/exports through an explicit release allowlist with source checksums.
- Isolate the stable Kubernetes Deployment selector from maintenance pods; existing Deployments with the old immutable selector need an operator-planned replacement.


- Audited all maintained English documentation after the source fixes. Clarified commit/image identity while the supplied package still reported 2.13.5, exact-erasure field/rollout/monitoring behavior, UTF-16 identifier lengths, and decay TTL clocks; synchronized OpenAPI descriptions. Made the first-install example stop before API rollout on migration failure, added bounded host readiness retries, and clarified release environment export and failed-Job waits.
- Fixed the example Kubernetes Secret: its `DATABASE_URL` carried `?sslmode=require`, which the shared TLS helper rejects alongside the base ConfigMap's `PG_SSL=true`, so an unchanged example installation failed at server startup and in migration/capacity Jobs. Verified TLS stays owned by `PG_SSL=true` and `PG_SSL_REJECT_UNAUTHORIZED=true`; a regression test loads the unchanged pair through the server configuration and migration TLS checks. Corrected the canary example's stale `2.12.0` version label.
- Rejected user IDs containing lone UTF-16 surrogates in upsert, search exclusion, privacy erasure and cursors. UTF-8 storage replaced them with U+FFFD, so distinct API identifiers could overwrite or erase another user's location.
- Restored pagination across identifiers stored before 2.13.1 that contain control characters other than NUL. Offset and cursor pages ending on such a row returned HTTP 500 because the next cursor could not be encoded, and the privacy API could not erase those rows. Cursor tuples accept such stored identifiers while still rejecting blank, over-255-character, NUL-containing and ill-formed values; upsert and search exclusion keep rejecting control characters.
- Added `POST /privacy/location/delete-exact`, which deletes a stored identifier byte-for-byte, including legacy identifiers with control characters or surrounding whitespace. It is a separate route rather than a body field because the pre-fix 2.13.5 build at `014d80e` drops unknown fields: a selector sent there would delete the normalized identity instead (for example `" padded"` → `"padded"`). Builds without the new route answer 404 and delete nothing. `POST /privacy/location/delete` preserves normalization for valid IDs, rejects control characters instead of trimming them into another identity, and rejects ill-formed Unicode and a `match` field. Each request deletes at most one identity, and neither route falls back to the other. A cross-version integration test runs the pre-fix build against the same database. The supplied package still reported 2.13.5; this consolidated release reports 2.14.0. See [rollout guidance](docs/OPERATIONS.md#rolling-out-exact-erasure).
- Raised the cursor length limit from 2,048 to 2,400 characters in request validation, the decoder and OpenAPI. A legacy 255-character identifier of control characters is JSON-escaped to six bytes per character, so the service could emit a signed cursor of up to 2,389 characters and then reject its own continuation with HTTP 400. Tests derive the worst case for both ranking modes.
- Empty or whitespace-only numeric environment values now fail startup. Previously they silently became `0`, for example disabling the cleanup lock timeout or idle-connection eviction, or changing a ranking weight. Remove such variables or set an explicit value before upgrading.
- Shutdown closes keep-alive connections as soon as their in-flight responses finish. It previously waited for the five-second keep-alive timeout and could reach the forced deadline without closing the PostgreSQL pool.
- Excluded the gitignored `deploy/kubernetes/secret.yaml` from the Docker build context and declared `yaml`, used by tests and monitoring checks, as a development dependency. No database migration was added.
- Reorganized the documentation into focused English guides for overview, architecture, API, configuration, development, deployment, operations, testing, security, privacy, and recovery.
- Added ten Mermaid diagrams, a presentation with speaker notes, and a source-backed documentation review; replaced superseded guides and dated review/evaluation narratives.
- Moved the production acceptance guide to `docs/PRODUCTION_READINESS.md` and updated internal links. The root README remains the project entry point and this changelog preserves release history.

## 2.13.5 — 2026-10-11

- Fix decay cursor reference precision so tied rows remain traversable across pages.
- Align migration/database tool environment defaults with the server, reject conflicting TLS URL options, and reject nonnumeric JSON input.
- Grant canary-only deployments/scale RBAC, update the privacy audit image, and preserve zero-error monitoring series.
- Upgrade checkout/setup-node in CI and release workflows to Node 24 actions, pinned to verified v7.0.1/v7.1.0 commit SHAs, removing the deprecated Node 20 runtime warning.
- Added independently validated Swagger enable/execution flags with development-compatible defaults. Production documentation no longer requires changing the Node environment or Docker build target.
- Required dedicated browser-native Basic login outside development and protected documentation HTML, JSON and assets. Production UI execution defaults to disabled; API bearer inputs remain separate and are not persisted.
- Added a runtime OpenAPI endpoint, distinct location/metrics/privacy schemes, deployment-aware feature/auth documentation and consistent configurable radius limits.
- Defaulted the OpenAPI server to the current origin, allowed explicit proxy base paths and resolved annotations independently of the working directory, including compiled-only distributions.
- Enforced LF checkouts, normalized the supplied ZIP's text/scripts and added a reproducible source packager with Unix executable metadata and local-credential/build exclusions.
- Corrected the documented Swagger port and first-install Kubernetes migration ordering. Added regression coverage and updated English/Persian operator documentation. No database migration was added.

## 2.13.4 — 2026-10-10

- Optimized nearby queries after VM evidence showed PostgreSQL CPU saturation. Materialized the distance-bearing candidates so each matching row's geodesic distance is calculated once, kept ranking inline, and delayed coordinate extraction until after the page limit. Ranking formulas, exact distances, count semantics, cursor format and schema are retained.
- Added real-PostGIS equivalence checks against captured v2.13.3 SQL for legacy/decay ranking, first/next cursor pages, offset pages, exclusions, ties and freshness/radius boundaries. Actual plans verify one distance expression and coordinate projection bounded by page size.
- Added exact next-page EXPLAIN bootstrap and JIT diagnostics. VM CI exercises both first/next plans and timestamped resource capture.
- Fixed sudo diagnostic Git ownership failures with checkout-scoped read-only trust, without changing global configuration. Bundles now identify the deployed package/Node/ranking version as well as the checkout SHA.
- Replaced terminal repaint streams with timestamped, parseable resource JSONL. Documented ownership recovery, preserving fixtures across query upgrades, pre/post-restart reports and the measured two-vCPU saturation point. The new query's VM capacity still requires measurement.

## 2.13.3 — 2026-10-10

- Separated successful HTTP benchmark throughput/latency from all attempts and failed responses. Performance budgets, matrix tables and canary gates now evaluate successful work so fast 503 rejections cannot suggest higher capacity or lower latency.
- Preserved existing all-attempt report fields. Legacy mixed latency with failures is unavailable for successful-latency gates; useful throughput can be recovered from counts.
- Kept VM fixtures within one day of the current time, with six days of TTL margin for persistence checks. Repeated seeding still upserts the same IDs without truncating data.
- Added configurable VM benchmark modes/concurrency/duration, separate report filenames, exact API first-page EXPLAIN plans and collection of resource streams.
- Shared the cursor SQL builder between the API and diagnostics without changing query semantics or adding a migration. CI checks real seeded row age/count and restart persistence.
- Documented the first VM evaluation: functional checks passed, TTL cleanup explained the one-row reduction, and concurrency 20 failed the zero-error budget with pool-queue rejection.

## 2.13.2 — 2026-10-10

- Added an isolated VM Compose profile, private generated credentials, a synthetic API smoke runner, sequential load/restart checks, a redacted support bundle and an English VM runbook. CI exercises the VM profile against the production image.

- Rechecked lifecycle readiness after the database probe so shutdown cannot turn an in-flight readiness check into a false HTTP 200.
- Shared user-ID bounds/control-character validation across request schemas and all cursor versions, including signed and legacy unsigned payloads.
- Preserved HTTP 400/413/415 for malformed JSON, corrupt compressed bodies, oversized bodies and unsupported charset/encoding, without exposing parser diagnostics. Forwarded errors after headers are sent.
- Rejected timer settings beyond signed 32-bit milliseconds and bearer credentials that cannot be transported as printable ASCII header tokens.
- Included Deployment rolling surge and the HPA ceiling in release capacity preflight, rounded percentage surge up, and documented terminating-pod connection reserves.
- Added focused regressions, refreshed the English API/OpenAPI and readiness review, and retained the existing relative-time behavior. No schema migration was added.

## 2.13.1 — 2026-10-10

- Replaced plural-only `timeAgo` strings with native English relative-time formatting, explicit future dates, `just now`, year units, valid-date checks and one shared response clock. Documented approximate 30-day months/365-day years and the display-only contract.
- Held admission capacity until asynchronous handlers settle, including after client disconnects; forwarded unexpected async errors through Express 4.
- Classified SQL transaction conflicts, Node network errors, pg/pg-pool connection timeouts and wrapped failures consistently for location/privacy retry responses and circuit handling.
- Destroyed pooled sessions when advisory-lock acquisition/unlock or an owned cleanup rollback leaves their state uncertain.
- Stopped new cleanup batches during drain and enforced a total process shutdown deadline even when database draining hangs.
- Rejected control characters in user IDs before database operations and documented the rule in OpenAPI.
- Omitted raw production error messages/stacks and redacted user-ID/coordinate fields in structured logs.
- Applied PostgreSQL TLS switches to operational pools/migration CLI and inherited the shared config in migration Jobs.
- Corrected cumulative EXPLAIN buffer accounting and rejected empty/missing-latency benchmark evidence.
- Silenced dotenv startup banners so operational JSON reports remain machine-readable and service logs keep their structured format.
- Restricted stable Service/PDB selectors to API pods; maintenance Job pods are excluded.
- Removed the Persian README and made all current repository documentation English-only. Added regression coverage and updated API/architecture/review documentation.

## 2.13.0 — 2026-10-10

- Added each result user's stored WGS84 `coordinate: {lat, lng}` to `/location/nearby` data in offset and cursor modes; retained metadata, ranking and cursor format. No schema migration required.
- Fixed startup probe connection leaks by releasing PostgreSQL clients on failed queries.
- Unified request/decoder cursor limits at 2048 characters for signed cursors containing long Unicode user IDs.
- Rejected unsafe page numbers/offset calculations as HTTP 400 before database access.
- Updated vulnerable dependencies; replaced ts-node-dev with tsx, upgraded node-cron to v4 and node-pg-migrate to v9, and aligned TypeScript declarations with runtime majors.
- Moved Docker/CI to Node 24 LTS and omitted development dependencies from production images while retaining the migration CLI as a runtime dependency.
- Fixed Swagger YAML descriptions containing colons, added nearby response schemas, and added a generated, CI-checked OpenAPI contract.
- Added HTTP/DB/cleanup/OpenAPI regression tests and real PostGIS coordinate integration fixtures.
- Added Persian documentation, architecture/API/review notes, a local environment example and executable release/entrypoint file modes.

## 2.12.0

- Added an opt-in `/privacy/location/delete` erasure endpoint with a dedicated privacy bearer token and zero-downtime previous-token rotation.
- The erasure response is idempotent/non-enumerating, uses a request body instead of a user identifier in the URL, and does not log the raw user ID.
- Added hard deletion of the current live location plus real-PostGIS integration coverage.
- Added aggregate privacy-deletion metrics and privacy DB-operation latency observations without location/user labels.
- Added `privacy:audit`, a read-only aggregate retention-health check with CI-friendly failure budgets for overdue and future-dated rows.
- Added privacy/retention, backup/PITR/restore and location-privacy incident runbooks, including mandatory post-restore erasure replay before reopening application traffic.
- Added Kubernetes/Compose secret/config wiring and NetworkPolicy guidance for the separate privacy workflow.

## 2.11.0

- Added optional bearer authentication for `/location/*` with primary/previous-token rotation and constant-time token comparison.
- Added independent optional bearer protection for `/metrics`; health probes remain unauthenticated.
- Authentication now runs before JSON body parsing and exports bounded auth-failure metrics without logging credentials.
- Added `BENCHMARK_AUTH_TOKEN` support and wired release canary/smoke Jobs to the location-auth Secret so protected deployments remain testable.
- Added opt-in Kubernetes ingress `NetworkPolicy` and namespace-scoped release RBAC examples; application pods continue to run without Kubernetes API tokens.
- Added security-boundary documentation clarifying that service authentication does not replace upstream authorization of caller-supplied user IDs.
- Added unit coverage for bearer parsing/token rotation and security-manifest guardrails.

## 2.10.0

- Added a provider-neutral Kubernetes release orchestrator with an atomic cluster-side release lock to prevent concurrent deployments.
- Added a migration compatibility policy that inspects only `exports.up` and blocks destructive/breaking schema changes unless an explicit reviewed override is supplied.
- Added in-cluster PostgreSQL capacity preflight before migrations/canary rollout, accounting for stable/HPA replicas plus the canary.
- Added release-specific migration, canary, capacity and post-promotion smoke Job templates that run the exact candidate image.
- Added immutable-image enforcement (`repository@sha256:...`) for production releases, with an explicit mutable-image escape hatch for non-production use.
- Added automated isolated canary rollout, repeated synthetic stable/candidate gates, observation window, stable promotion, post-promotion smoke test and application-image rollback on promotion failure.
- Added GitHub Actions examples for CI with a real PostGIS service and for serialized production release orchestration.
- Added unit coverage for migration-policy detection and documented the remaining production acceptance gates.

## 2.9.0

- Added `X-Nearby-Rejection-Reason` on controlled overload/rate-limit/retryable-database responses so load tests and rollout gates can distinguish intentional load shedding without exposing user/location data.
- Extended the HTTP benchmark report with controlled-rejection counts/rates by reason.
- Added `canary:compare`, which alternates repeated stable/candidate load runs, aggregates error/rejection/throughput/latency signals and exits non-zero when relative or absolute rollout budgets fail.
- Added pure canary-gate unit coverage for aggregation and rollback criteria.
- Reworked the optional PrometheusRule example around a 99.9% availability SLO with multi-window burn-rate recording rules and fast/medium/slow/long error-budget alerts.
- Added isolated canary Deployment/Service examples plus an optional Gateway API 95/5 HTTPRoute example; none are included in the default kustomization.
- Documented a capacity-gated canary rollout/rollback runbook.

## 2.8.0

- Added optional per-replica adaptive concurrency using conservative AIMD control under the existing hard admission caps.
- New replicas can start below their configured hard limits and ramp up only after sustained healthy PostgreSQL latency, reducing HPA cold-start pressure on the database.
- Adaptive limits decrease on high DB latency, retryable database failures, or PostgreSQL pool queue pressure, with cooldown/hysteresis to avoid rapid oscillation.
- Added dedicated DB-operation latency histograms plus adaptive effective-limit, utilization, EWMA-latency and adjustment metrics.
- Added Kubernetes HPA and PrometheusRule examples as explicit opt-in resources; they are intentionally excluded from the default kustomization until database capacity and SLO thresholds are validated.
- Extended `capacity:check` to report `maxSafeReplicas` from real PostgreSQL connection limits, pool size and reserved headroom.
- Added adaptive-concurrency unit coverage and Kubernetes rollout guidance for capacity-gated autoscaling.

## 2.7.0

- Added explicit process lifecycle state (`starting`, `ready`, `draining`, `stopped`).
- Added graceful drain behavior: readiness fails immediately, new location work is rejected, then the listener closes after a propagation delay.
- Added lifecycle Prometheus metrics for state and active non-probe requests.
- Added `SHUTDOWN_DRAIN_DELAY_MS` validation and startup migration toggle.
- Made Docker entrypoint migrations optional for multi-replica orchestration.
- Added production-oriented Kubernetes Deployment, Service, PDB, ConfigMap, secret example, migration Job example, probes, security contexts and resource defaults.
- Added lifecycle state-machine unit tests.

## 2.6.0

- Added request admission control for location workloads with independent nearby/upsert in-flight limits.
- Added PostgreSQL pool-queue backpressure so new work is rejected before an already-saturated client queue grows without bound.
- Added a small database availability circuit breaker with half-open probing for connection/availability failures.
- Query timeouts and lock-contention errors return retryable 503 responses but intentionally do not trip the global DB circuit.
- Added optional bounded per-replica fixed-window rate limiting with no external dependency; it remains disabled by default when a gateway provides global limits.
- Added `Retry-After` responses plus Prometheus metrics for admission rejection reasons, rate-limit rejection, circuit state/failure streak and in-flight workloads.
- Added optional Express proxy trust for correct client IP handling behind a trusted reverse proxy.
- Expanded unit coverage for concurrency admission, pool backpressure, circuit open/half-open/recovery and rate-window reset behavior.

## 2.5.0

- Added a repeatable benchmark matrix runner across dataset sizes, radii, concurrency levels and first/deep cursor/offset request modes.
- Added warm-up-aware HTTP benchmarking and explicit `cursor_next` measurement so signed-cursor count reuse is measured instead of only first-page cost.
- Added benchmark performance budgets for error rate, p95/p99 latency and minimum RPS with CI-friendly non-zero exit codes.
- Added JSON and Markdown benchmark matrix reports suitable for comparing runs over time.
- Added optional EXPLAIN gates per dataset/radius to correlate HTTP regressions with PostGIS plan changes.
- Added `capacity:check`, which compares real PostgreSQL connection capacity with expected service replicas and `PG_POOL_MAX` before deployment.
- Expanded database inspection with cache-hit ratio, temp files/bytes, deadlocks, connection state, index definitions and scan ratios.
- Added pure unit coverage for benchmark statistics, report rendering and connection-budget calculations.

## 2.4.0

- Added a PostgreSQL session advisory lock so only one service replica performs stale-location cleanup at a time.
- Bounded each cleanup run with `CLEANUP_MAX_BATCHES_PER_RUN` and optional inter-batch delay to avoid long maintenance bursts.
- Added cleanup-specific transaction-local statement/lock timeouts so request query budgets can remain strict without making maintenance brittle.
- Added cleanup outcome/batch/duration Prometheus metrics.
- Added PostgreSQL `application_name` and TCP keepalive configuration for better database-side observability and connection resilience.
- Added `benchmark:seed`, a guarded PostGIS-native synthetic location generator using `generate_series` and `ST_Project`.
- Added `inspect:db`, a read-only database/index/vacuum/size inspection report for benchmark interpretation.
- Extended `analyze:nearby` with JSON plan summaries and optional GiST-index/execution-time assertions suitable for staging/CI performance gates.
- Added real-Postgres integration coverage for cross-connection advisory-lock exclusion.

## 2.3.0

- Added HMAC-SHA256 signed cursor envelopes with tamper detection.
- Added primary/previous signing secrets for zero-downtime cursor key rotation.
- Added `CURSOR_REQUIRE_SIGNATURE` for retiring unsigned legacy cursors after a migration window.
- Added cursor payload v3 carrying `totalCount`, a non-sliding issuance timestamp, and optional decay-ranking snapshot metadata.
- Signed cursor pagination now computes the full candidate `totalCount` on the first page only; subsequent v3 pages reuse the trusted carried count and avoid repeated `COUNT(*)`. Unsigned compatibility pages recount rather than trusting client-controlled count metadata.
- v3 cursor sessions now expire in both legacy and decay ranking modes.
- Preserved unsigned v1/v2 compatibility by default for rolling upgrades.
- Added unit coverage for signing, tampering, rotation, signature enforcement and count reuse.

## 2.2.0

- Added opt-in normalized distance/freshness decay ranking while keeping legacy ranking as the default.
- Added configurable distance scale, freshness half-life and ranking weights with central validation.
- Added decay cursor v2 with a pinned ranking reference time and ranking-profile ID.
- Added decay cursor expiry and pinned TTL cutoff for more consistent multi-page ranking sessions.
- Ranking snapshots now originate from the PostgreSQL clock to avoid app/DB clock-skew artifacts.
- Preserved v2.1 legacy cursor compatibility while legacy ranking is active.
- Added ranking mode labels to nearby Prometheus metrics and response metadata.
- Added decay ranking unit/integration coverage.
- Added read-only legacy-vs-decay ranking comparison tooling.
- Added ranking-aware `EXPLAIN ANALYZE` and a dependency-free HTTP load benchmark runner.

## 2.1.0

- Added backward-compatible keyset/cursor pagination for nearby searches.
- Added query-context-bound opaque cursors and migration cursors on offset responses.
- Added structured JSON logging and request IDs without logging coordinates or request bodies.
- Added Prometheus-compatible `/metrics` endpoint and PostgreSQL pool gauges.
- Added bounded graceful shutdown and quieter health/metrics access logging.
- Added `Cache-Control: no-store` and safer malformed/oversized JSON handling.
- Added cursor unit tests and real-PostGIS cursor integration coverage.
- Added `analyze:nearby` to inspect the real PostGIS execution plan with `EXPLAIN ANALYZE`.
- Kept the existing proximity + recency ranking formula unchanged for product compatibility.

## 1.0.0 - 2026-10-25

Initial repository publication.

- Store one current WGS84 location per user and search fresh nearby locations with PostGIS geography, radius filtering and pagination.
- Return each matched user's stored coordinates, distance, exact update timestamp and dynamic display age.
- Support English and Persian human-readable API responses through `Accept-Language`, with English as the default and request-local language isolation.
- Calculate display age using one server timestamp captured at request start, elapsed short units and completed UTC calendar months/years.
- Provide process liveness, database readiness and authenticated interactive Swagger documentation with a generated OpenAPI contract.
- Include validated configuration, private credential initialization, a persistent Compose deployment, owned database/cleanup lifecycles and graceful shutdown.
- Disable dependency install scripts in Docker and documented installation commands; project build and runtime commands remain explicit.
- Include unit, HTTP, contract and optional Swagger DOM tests, a dedicated PostGIS integration suite, operational guides and reproducible source packaging.

The schema, ranking formula, TTL semantics and VM deployment identity remain compatible with the reviewed source package. See [Release validation](docs/VALIDATION.md) for executed checks and remaining deployment acceptance work.
