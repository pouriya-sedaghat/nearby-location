# Production acceptance gates

[Deployment](DEPLOYMENT.md) · [Testing](TESTING.md) · [Operations](OPERATIONS.md)

## Acceptance model

Accept an exact image, configuration, database, and target environment. The repository contains implementation controls, CI, manifests, and validation tools; their presence does not certify a production workload or recovery objective. Historical test counts and VM measurements are not current acceptance evidence.

Complete the record below for each launch or material infrastructure change. Source-only documentation validation should not mark environment gates as passed.

## Gate record

| Gate | Required evidence | Owner / result / evidence link |
|---|---|---|
| Release identity | Exact commit, clean/understood working tree, immutable image, matching migration checkout, configuration revision | To record |
| Current CI | Dependency/build/audit, script/migration/OpenAPI/monitoring checks, unit/HTTP/tooling, real PostGIS integration, production-image checks for this revision | To record |
| Database/migration | PostGIS availability, runtime/migration grants, verified TLS, upgrade rehearsal, compatible schema for previous/candidate images | To record |
| Caller identity/authorization | Protected surfaces, upstream ownership/consent/visibility, direct-access restrictions, safe proxy headers | To record |
| Secrets | Independent credentials/keys, distribution and rotation rehearsal, fleet-wide cursor compatibility, scraper credentials | To record |
| Workload/relevance | Representative density/freshness/radii/request mix, both relevant pagination paths, accepted ranking behavior, fixed budgets | To record |
| Capacity | Pool budget at HPA maximum + surge + canary, terminating/external reserve, measured DB/query/resource headroom | To record |
| Retention/erasure | Approved TTL/lag/cursor freshness, audit thresholds, stop/drain/delete ordering, downstream and backup policy | To record |
| Recovery | Restart/failover, isolated backup restore, erasure replay, measured RPO/RTO, ownership | To record |
| Platform controls | Non-root/read-only/security context, network/ingress/TLS, probes/drain timing, resources and disruption behavior | To record |
| Monitoring | All replicas scraped, accepted latency/error/rejection views, cleanup/DB pressure, alert receiver and escalation tested | To record |
| Release/rollback | First-install or canary rehearsal, failed gate/promotion recovery, compatible config/schema, stale lock handling | To record |
| Launch/soak | Controlled routing, observation interval, acceptable useful throughput/error/latency, support handover | To record |

## Evidence to collect

- Current workflow outcomes and image provenance.
- Functional/API acceptance including stored coordinates, exclusion, cursor traversal, auth rejection, and approved erasure checks.
- Workload matrix with dataset/environment assumptions and success-path latency plus errors/rejections.
- Query plans for accepted selective and wide-radius cases.
- Capacity output and tested scaling/termination behavior.
- Recovery, retention, credential rotation, and failed-release drill results.
- Actual monitoring alert delivery and on-call/runbook ownership.

Tests that truncate or seed synthetic data belong on isolated databases. The VM fixture smoke is not a live-production probe; the release's post-promotion smoke uses read-only nearby requests.

## Launch decision

Record who accepts each gate, the residual limitation, rollback/cutover criteria, and the observation window. Hold launch when a required gate lacks evidence; remediate and rerun only the affected acceptance work. The [deployment guide](DEPLOYMENT.md) and [runbooks](README.md#runbooks) provide the operational procedures.
