# 2.14.1 routing and validation review

[Documentation index](README.md) · [Upgrade guide](UPGRADING.md) · [Historical baseline review](RELEASE_REVIEW.md)

**Date:** 2026-10-26. **Baseline:** main commit `047fa6f0c7feb45042d6a4724962b96c8c44515c` (2.14.0).
**Local runtime:** Node.js 24.22.1 / npm 11.9.0. **Reviewed application:** 2.14.1.

## Corrections

| Area | Result |
|---|---|
| Swagger routing | UI, JSON and local assets use `/api/docs`; browser UI uses `/api/docs/`. Old `/api-docs` URLs return 404. Documentation authentication runs before JSON parsing. |
| Documentation boundary | Only GET/HEAD serve resources. Unknown resources/unsupported methods return English JSON 404. HTML is served only at the UI root. Swagger Execute continues to call the API routes. |
| Wire Unicode | Generic UTF-16 now selects the decoder using its BOM or initial ASCII JSON code unit. Malformed wire Unicode is rejected even in fields the request schema ignores; valid BE/LE, with/without BOM, remain supported. |
| PostgreSQL URI | One pure validator covers configuration, server/tool pools and migration. Every URI component must contain valid escaped UTF-8; fragments, malformed escapes, ill-formed Unicode and decoded NUL fail without echoing credentials. |
| TLS owner | Explicit `ssl: false` prevents ambient PGSSLMODE from changing the off policy. Migration children get the matching fallback. URI-owned TLS remains supported with PG_SSL=false; conflicting URI options are refused with PG_SSL=true. |
| Fail-fast configuration | Invalid cron expressions and retention values beyond PostgreSQL's signed integer parameter fail before database startup work. |
| Documentation/distribution | Current URLs, examples, image versions, package/lock/OpenAPI version and upgrade notes identify 2.14.1. Source checksums are regenerated; historical 2.14.0 evidence remains available. |

Nine focused boundary tests were added before implementation: eight failed on the baseline and one existing valid-UTF-16 transport case passed. They pass after the corrections. Existing configuration, HTTP, OpenAPI, operational and DOM tests also exercise the corrected paths.

## Broader review

The review covered configuration and TLS ownership; JSON and identifier validation;
request-local language/timeAgo behavior; location/privacy controllers; parameterized
spatial queries and cursor signing/count reuse; cleanup transaction/advisory-lock
ownership; admission and lifecycle handling; auth, bounded metrics and private
logging; production-image inputs; source packaging; Compose/Kubernetes examples;
and release/CI configuration. Existing behavior outside the corrections was retained.

The initial migration, spatial SQL, ranking/cursor algorithms, normalized/exact
erasure contracts, auth modes and relative-time implementation are unchanged.
The dependency graph is unchanged apart from the package's root version metadata.
Existing `.env`, VM project/database identity and volume remain in use. Updating
this repository does not modify a running VM or an exported 1.0.0 image.

## Executed locally before publication

| Check | Result |
|---|---|
| Full suite, including optional Swagger DOM execution | **207 passed, 0 failed, 1 skipped** (208 tests); the skipped suite requires real PostGIS |
| Targeted boundary/config/docs/tool checks | 31 passed after the initial corrections |
| TypeScript/build | Strict typecheck and compiled build passed |
| API contract | Generated OpenAPI freshness, schema/example validation and runtime feature/auth projection passed |
| Migration/scripts | Initial migration compatibility policy and syntax checks for 23 operational JS files passed |
| Audits | Full and production npm scopes reported **0 known findings** on the review date |
| Production dependencies | Clean `npm ci --ignore-scripts --omit=dev`; the production stage has neither source TypeScript nor the compiler |
| Production HTTP | **22 checks passed** using real listeners and in-memory persistence: both languages, timeAgo, protected docs/assets, HEAD/404 boundaries, location bearer, privacy routes and metrics bearer |
| Production CLI | Migration CLI help worked using production-only dependencies and shared scripts |
| Packaging/configuration | Source checksums, safe paths/modes, exclusions and daemon-free Compose rendering are checked for the final candidate |

DOM execution uses jsdom 30.1.3 as an external QA dependency; it is not added to
the service lock graph. HTTP/persistence adapters are test doubles. npm advisory
results are a snapshot, not proof that an application or container has no vulnerabilities.

## CI and environment acceptance

The candidate is submitted through a pull request. Inspect that exact commit's
CI result for real PostGIS integration, promtool rule behavior, production Docker
build and isolated VM-profile startup, restart and persistence checks. CI must
pass before this candidate is merged into main.

No Docker daemon, real PostgreSQL server or Kubernetes cluster was available
locally. A local integration skip is not a passed PostGIS test. This review does
not claim a real browser, cluster canary rollout, load/capacity test or backup
restore drill. Those remain target-environment acceptance tasks in
[Production readiness](PRODUCTION_READINESS.md).
