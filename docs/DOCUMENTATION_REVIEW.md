# Historical Documentation review and replacement

This document records the supplied source's earlier documentation review. It is not release-acceptance evidence for 2.14.0; see [Release review](RELEASE_REVIEW.md).

**Historically reviewed source:** `33312634920a3409ab58a04133ef6f0960448d33` on `main` · **Package:** 2.13.5 plus Unreleased changes · **Review date:** 2026-10-12

## Full audit after the source fixes

The latest audit read all 22 tracked Markdown documents, including the changelog, deployment entry points, presentation and three runbooks. It compared maintained instructions with current routes, validation, configuration, SQL, metrics, manifests, tools and CI, and inspected the pre-fix build at `014d80e` for rollout claims.

| Verified inconsistency | Correction |
|---|---|
| Both pre-fix and current source report package version 2.13.5, while guides used that version to infer exact-route support | Identify the reviewed source, Unreleased changes, and deployed commit/image digest |
| The API introduction said all unknown fields are stripped | Describe upsert/nearby stripping, normalized erasure's `match` refusal, and exact erasure's strict body |
| Identifier lengths were described as characters | State the UTF-16 code-unit bound and the two-unit cost of astral characters |
| Generic freshness wording omitted the decay continuation's older reference | State that TTL and scoring use the pinned clock in decay mode |
| The exact-erasure 404 alert assumed old replicas knew the new route label | Use workflow/gateway evidence; explain old replicas label it `/not_found` |
| Rollout notes omitted older replicas' smaller cursor limit | Document 2,048 versus 2,400 characters and traversal restart behavior |
| The first-install command block could continue after migration failure | Stop the subshell before API application on failed preparation or migration completion |
| Host readiness was checked immediately after detached container startup | Use bounded retries for startup connection refusals and transient 503s |
| Release examples did not explicitly export required shell values or explain failed-Job waits | Export child-process settings and document the completion-wait timeout |
| The old review's current-tense TLS workaround contradicted the corrected sample | Preserve it as historical context and describe the present verified-TLS pair |

The Markdown placement remains appropriate: the root contains the project entry point and release history, task guides live in `docs/`, and deployment-specific entry points live beside their manifests/scripts. No additional guide deletion is needed for this audit.

## Original replacement finding

The original rewrite reviewed source `cc2c815c39913e7363e65f2c19d05eea011fa601`. The following findings and replacement map describe that earlier documentation change.

The repository already had substantial API, architecture, setup, Kubernetes, VM, security/privacy, and review material. The gap was not absence of all deployment documentation. It was an oversized entry point, overlapping guides, mixed-language/historical content, missing dedicated development/presentation documents, and navigation that made a coherent operating procedure hard to discover.

Some existing explanations and diagrams were accurate; their verified facts are carried into the replacement. This is a documentation reorganization and rewrite, not an application feature release or a new performance certification.

## Verified gaps and source-backed corrections

| Finding in previous documentation/resources | Evidence | Replacement |
|---|---|---|
| Root README combined many detailed operator/reference sections | Previous README covered API, configuration, benchmarks, capacity, canary, privacy, and setup in one long file | Short README, task-oriented index, focused guides |
| English/Persian broad guides overlapped API/architecture/operator material | Previous `GUIDE.en.md`, `GUIDE.fa.md`, root notes and review documents | One maintained English guide per responsibility |
| No dedicated development or presentation document | Repository Markdown inventory at reviewed commit | Development workflow, source map, and ten-slide speaker-note document |
| Diagrams were present but incomplete as a navigable explanation set | Previous architecture request flow plus diagram searches/inventory | System, routing, entity, cursor, circuit, lifecycle, deployment, release, privacy, presentation diagrams |
| Current release guidance referenced earlier review/version evidence | Previous readiness text referred to v2.13.4 and historical test/VM results | Exact-release gate record without inherited pass claims |
| Original Kubernetes Secret/ConfigMap pair had a TLS conflict | Secret URL contained `sslmode=require`; ConfigMap used `PG_SSL=true`; shared TLS helper rejected the pair | Initial operator preparation guidance; the later source fix removed the URL parameter |
| First installation, upgrade, and rollback responsibilities needed clearer separation | Release script requires an existing stable Deployment and restores image only | Distinct first-install and existing-install procedures; configuration/schema recovery boundaries |
| Readiness could be mistaken for complete application health | Health controller pings `SELECT 1`; DB connect does not inspect schema | Query-path verification in deployment/operations |
| Cursor consistency and retention require precise boundaries | Model/controller/cursor pin scoring context and trusted count while the table stays live | Explicit live-data, count, TTL-reference, and clock semantics |
| VM and production release use different smoke implementations | VM invokes fixture-writing smoke; release template invokes read-only benchmark | Clear test-target and evidence distinctions |

## Source inspection scope

The review inspected application bootstrap/routing, validation, controllers, parameterized SQL/model, ranking, cursors, admission/circuit/adaptive controls, lifecycle, pool/TLS handling, cleanup, logging/metrics, OpenAPI generation, migrations, Docker/Compose, VM tools, Kubernetes manifests and release automation, operational scripts, CI, and the relevant tests.

Primary anchors include [configuration](../src/config/env.ts), [app](../src/app.ts), [model](../src/models/location.model.ts), [location controller](../src/controllers/location.controller.ts), [cursor](../src/utils/cursor.ts), [cleanup](../src/jobs/cleanup.job.ts), [TLS helper](../scripts/lib/postgres-options.js), [CI](../.github/workflows/ci.yml), and [release script](../deploy/kubernetes/release/release.sh).

## Replacement map

| Superseded material | Current destination |
|---|---|
| Long root README and broad English/Persian guides | [Entry point](../README.md), [index](README.md), [overview](OVERVIEW.md), focused guides |
| `IMPLEMENTATION_NOTES.md` | [Architecture](ARCHITECTURE.md), [overview](OVERVIEW.md), historical changelog |
| Prior readiness narrative | [Exact-environment gate record](PRODUCTION_READINESS.md) |
| Previous API / relative-time / Swagger narratives | [API](API.md), [configuration](CONFIGURATION.md), [development](DEVELOPMENT.md) |
| Previous architecture narrative | [Architecture](ARCHITECTURE.md) with complete diagram catalogue |
| Prior VM testing procedure | [VM procedure](VM_TESTING.md), [testing](TESTING.md) |
| Dated source reviews, revision notes, and VM evaluations | Git history for original evidence; [testing evidence format](TESTING.md#record-evidence) for new runs |
| Previous privacy and runbook text | [Privacy](PRIVACY_AND_RETENTION.md), [security](SECURITY.md), rewritten runbooks |
| Previous Kubernetes/release READMEs | [Deployment](DEPLOYMENT.md), focused [manifest entry point](../deploy/kubernetes/README.md), [release procedure](../deploy/kubernetes/release/README.md) |

The original replacement removed/replaced the superseded narrative files; Git history preserves their contents. `CHANGELOG.md` preserves released history and records the documentation reorganization under Unreleased; generated `docs/openapi.json` remains the machine contract. The root contains the project README and changelog, while the specialized production acceptance guide lives in `docs/PRODUCTION_READINESS.md`.

## Validation and remaining boundaries

Validate links/anchors, all application-variable coverage/defaults, npm command names, Mermaid syntax, shell/JSON examples, generated OpenAPI drift, and the existing unit/HTTP/tooling suite. Record actual validation results in the pull request rather than embedding a permanent current-CI claim here.

The latest audit changes guides and OpenAPI descriptions without changing request behavior, SQL, migrations, or deployment manifests. The current Secret example has no URL TLS parameters and works with the ConfigMap's verified `PG_SSL=true` ownership; its credentials still need replacement. A regression test loads this pair through server and migration TLS checks. See the Unreleased [changelog](../CHANGELOG.md) entry.

Validation covers local links/anchors, ten Mermaid diagrams, all 71 runtime variables/defaults, npm command names, shell/JSON examples, generated OpenAPI, and existing tests. The first-install block is also exercised with simulated preparation/migration failures to verify that it never applies API resources afterward. Preserve run-specific outcomes in the pull request. No production host/cluster/database deployment, load certification, failover, or backup drill is performed by a documentation audit. Use [production acceptance](PRODUCTION_READINESS.md) for those decisions.
