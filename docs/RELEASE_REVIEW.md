# 2.14.0 release review

This is the historical baseline review. See [the 2.14.1 review](REVIEW_2.14.1.md) for the current Swagger and validation patch.

[Documentation index](README.md) · [Upgrade guide](UPGRADING.md)

**Review date:** 2026-10-25. **Runtime:** Node.js 24.22.1 / npm 11.9.0. **Application:** 2.14.0.

## Source and version

The release integrates the supplied 2.13.5 source and its pending changes with the published 1.0.0 repository. The archive's embedded Git configuration, hooks, logs and object history are excluded. Version 2.14.0 identifies the new bilingual support and consolidated fixes relative to that supplied source; the earlier source history is retained in the changelog as historical material rather than fabricated repository tags.

The initial migration is byte-identical to the published 1.0.0 migration. Existing VM database identity, PostgreSQL major version, PostGIS image, private credentials, loopback binding, project name and `nearby-vm_pgdata` volume are preserved. The evaluation helper uses a separate project and default port. Existing Kubernetes installations must review the tightened immutable Deployment selector before applying examples.

## Reviewed corrections

| Area | Result |
|---|---|
| Dependencies | Body-parser 1.20.9, fast-uri 3.1.9 and Zod 4.6.7 replace the supplied vulnerable graph; Express remains 4.22.3 and migration tooling remains 9.0.0 |
| Identifier safety | Explicit UTF-16 bounds preserve the 255-unit API/cursor contract after the validator update; lone surrogates, NUL and invalid wire encodings cannot alias an identity |
| Erasure | Normalized and exact routes stay separate, authenticated and idempotent; exact requests never fall back to normalized deletion; legacy behavior is captured in a portable contract fixture |
| Language/time | English/Persian text is request-local; keys/codes/numbers/ISO timestamps are unchanged; age uses a trusted request-start instant, cached native formatters and complete UTC calendar months/years |
| Resource lifecycle | Signals cover connection startup; retry delays cancel; cleanup disposal drains active work and destroys its schedule; HTTP and cleanup drain independently before pool closure; disposal failure still closes remaining resources and exits nonzero |
| HTTP/observability | Authorization precedes JSON parsing, parser errors are sanitized/localized, private responses remain no-store and metric method/route labels have bounded cardinality |
| OpenAPI/Swagger | A single explicit contract replaces annotation scanning; canonical export ignores runtime environment files; live docs retain feature/auth projection and isolated UI options with language input and named examples |
| Installation/image | Dependency install hooks are disabled; production installs omit development dependencies and the final stage uses the built-in non-root user without compiler/PostgreSQL client tooling |
| Deployment/release | Private VM initialization and identity are retained, advanced secret settings are forwarded, evaluation is isolated, workflow permissions remain read-only and release rendering rejects malformed image/namespace input |
| Distribution | An explicit source allowlist, symlink refusal, deterministic modes/timestamps and a regenerated checksum manifest exclude live environment files, exports, keys, dependencies and build output |

## Executed checks before publication

| Check | Evidence |
|---|---|
| Supplied-source baseline | 162 passed, no failures, one real-PostGIS suite skipped |
| Final full local suite | **198 passed, 0 failed, 1 skipped**; TAP records 199 tests with no cancellation |
| TypeScript | Strict type checking and compiled build passed |
| Contract | OpenAPI freshness, full structural validation, unique operation IDs and named request-example validation passed |
| HTTP languages | Negotiation/regions/quality/fallback, concurrent language isolation, schema/parser/auth/cursor errors, stable machine fields and per-request age passed |
| Swagger DOM | Actual bundled scripts load the live contract, execute baseline operations, set the Persian language input and verify localized output; read-only mode also passed |
| Lifecycle | Startup cancellation, retry-delay cancellation, active cleanup draining/disposal, keep-alive drain, forced deadline and disposal failure behavior passed |
| Production-only installation | Clean `npm ci --ignore-scripts --omit=dev`; seven HTTP operations, both languages, signed cursor, privacy semantics and authenticated English docs passed with fake persistence; migration CLI help ran |
| Dependency audits | Full and production scopes both report **0 known findings** on the review date |
| Compose/application configuration | Official Compose 5.6.1 resolved generated private settings without a daemon; VM identity, volume, production target, loopback exposure and service-token forwarding passed application validation |
| Operational tools | Migration policy passed; 23 operational JavaScript files, all maintained shell files and Python tools passed syntax checks |
| Manifests/packaging | Configuration/secret TLS ownership, service/deployment selectors, image versions, source exclusions, symlink refusal and reproducible archives passed regression checks |

HTTP/production checks use real local listeners with fake database/model operations. Swagger DOM checks use jsdom 30.1.3 installed outside the project. The legacy erasure fixture is a captured contract, not execution of an old full binary. npm findings are an advisory snapshot, not proof of zero application or image vulnerabilities.

## Remaining environment acceptance

No Docker daemon, real PostgreSQL/PostGIS instance or Kubernetes cluster is available in the review environment. Real migration execution, spatial integration/query plans, production image build/start, monitoring execution through promtool, cluster canary promotion, browser rendering and load/recovery acceptance were not run locally. A skipped PostGIS suite is not a passed integration test.

CI is configured to run the dedicated PostGIS suite, monitoring rules, Docker production build and isolated VM smoke/persistence checks after publication. Inspect the workflow result for the exact commit; configuration of those checks is not a claim that they already passed. No deployed VM, cluster, database or production credential is modified by this source update. Follow [Production readiness](PRODUCTION_READINESS.md) before accepting a deployment.
