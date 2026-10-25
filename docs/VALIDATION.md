# Implementation and release validation

[Documentation index](../README.md)

**Application version:** `1.0.0`

**Validation date:** `2026-10-25`

**Runtime used:** Node.js `24.22.1`, npm `11.9.0`

## Scope and implementation decisions

All source, request/response contracts, spatial queries, migrations, environment handling, scripts, container configuration, tests and English guides were reviewed. The refactor replaces implicit shared runtime state with explicit construction and ownership. Correct existing SQL, schema/index definitions, health semantics, request limits, credential generation and source-packaging controls are retained.

| Area | Final implementation |
| --- | --- |
| Configuration | Pure `parseConfig(values)` and explicit `loadConfig()`; no environment-file loading during module import; Express mode is set from validated configuration |
| Database | Explicit pool factory, owned lifecycle, typed settings, cancellable retry delays and idempotent disposal |
| Persistence | Typed `LocationRepository` with injected query interface and shared search/cleanup TTL; parameterized SQL is unchanged |
| HTTP | Isolated application/controller/router factories; explicit repository, health and logger dependencies; strict UTF-8 byte verification before JSON decoding; no module singleton replacement in tests |
| Lifecycle | Separate composition root and service owner; signal handling before connection work, startup rollback, repeated-signal protection, active HTTP/cleanup draining and pool closure |
| Cleanup | One owned cron schedule; overlap prevention, bounded batches, active-batch draining and task destruction, including scheduler failure handling |
| Swagger | One explicit contract definition; route annotation scanning and its duplicate definitions are removed; UI initialization options are isolated per instance |
| Validation libraries | Zod 4.6.7 and node-cron 4.6.0; public validation error tree retained through a small formatter; type packages match Node.js 24 and Express 4 |
| Response language | Request-local Accept-Language negotiation for English and Persian, typed message catalog, cached per-language schemas and per-parse validator maps; no global locale mutation |
| Development | tsx watch mode replaces the previous watcher; type checking remains a separate required check |
| Production distribution | Locked production-only dependency installation; migration CLI is an explicit runtime dependency; final image uses the built-in non-root user and copies only required runtime files |
| Tooling | Benchmark uses explicit factories and one shared SQL baseline; unused duplicate fixture removed; private configuration initialization and release packaging protections retained |

English/Persian response support uses the standard Accept-Language header. No HTTP operation or database migration is added. The application version stays `1.0.0`. Location request/response fields, default English messages, documented status codes, radius and pagination semantics, ranking, TTL behavior and database schema are preserved. Malformed UTF-8 bytes that previously aliased an identifier through decoder replacement are correctly rejected as a 400 parser error. Valid Unicode, UTF-8 BOM and supported UTF-16 transports remain accepted. OpenAPI documents language negotiation, response headers, both success-message variants and localized examples.

## Relative-time correction

The corrected helper already computed age dynamically from a stored timestamp and an explicit reference instant. The latest change captures that reference at the start of the server request, before parsing or database work, rather than after the query. It uses cached native `Intl.RelativeTimeFormat` for English and Persian without adding a dependency. Display age is never persisted or accepted from a client clock; later requests recompute it from the original timestamp.

Seconds through weeks are completed elapsed units, with 24-hour days. Months and years are completed UTC Gregorian calendar anniversaries in both languages, preserving time of day and clamping an unavailable day to the target month's final day. Leap years follow Gregorian century rules. Future timestamps retain zero age in the selected language. Invalid timestamps fail instead of producing misleading age text. Every result on a page shares one request-start instant, and the exact `updatedAt` is preserved without mutation. A single elapsed duration is insufficient to identify calendar months or years, so both instants are retained by the helper.

The helper tests use explicit references without replacing global `Date`. Coverage includes both languages, singular/plural forms and millisecond thresholds, month lengths, month-end anniversaries, leap years/centuries, years below 100, complete-year boundaries, future/invalid dates, offset-equivalent instants, daylight-saving offsets and non-mutation. HTTP tests advance the injected clock during database work to verify request-start semantics and then make a later request to verify recomputation. Concurrent mixed-language requests test isolation. Display age remains rounded human-readable data rather than a precise duration for client arithmetic.

## Configuration and deployment compatibility

The current `.env.example`, credential initializer, Compose services, project name, database identity, image tags, port binding and persistent volume configuration are unchanged. A running VM continues to use its existing `.env` and `nearby-vm_pgdata` volume. No password regeneration, role change, data export/import or new schema migration is required.

Direct Node execution now requires a valid PostgreSQL `DATABASE_URL`; the previous hard-coded fallback credential is removed. Missing/malformed configuration fails before pool construction. Compose already supplies the generated URI, so this change requires no new VM setting. `npm start` executes compiled JavaScript directly and needs no development dependency; configuration defaults to production unless the operator selects another runtime mode.

Zod's detailed default English field wording may differ between library versions. The public `_errors` hierarchy, field paths and documented top-level messages remain stable; clients should not parse library-generated English strings. See [API](API.md).

## Executed checks

| Check | Result |
| --- | --- |
| Clean locked installation | `npm ci --ignore-scripts` completed |
| Type checking and TypeScript build | Passed |
| Full suite, including optional Swagger DOM cases | 93 passed, 0 failed; 1 real-PostGIS suite skipped |
| OpenAPI freshness and bilingual contract validation | `npm run openapi:check` passed; header parameters, response language/cache headers and all 24 examples validate; live responses in both languages match their schemas |
| Validation compatibility comparison | 119 input cases retained acceptance/rejection and successful normalization compared with the preceding validator implementation |
| SQL compatibility comparison | Upsert, nearby page, empty-page count fallback and cleanup SQL/parameter sequences match the preceding implementation after whitespace normalization |
| Application isolation | Two concurrent app instances retain separate radius defaults, credentials, live specifications and UI execution flags |
| Import behavior | Invalid local `.env` does not affect module imports; imports start no cleanup schedule |
| Database ownership | Retry/probe/acquisition cancellation, failed-client release, original error preservation, TLS settings and idempotent disposal passed |
| Shutdown and startup failures | Listener and cleanup-start failures, startup cancellation, repeated termination signals, active HTTP/cleanup draining and nonzero failure status passed |
| Real executable startup cancellation | The actual entrypoint cancels a retry against an unavailable local database port and closes its pool; no real database was used |
| Cron lifecycle | Active-batch draining and scheduler failure handling passed; the real cron registry returns to its initial task count after disposal |
| Relative-time display | Eight helper groups, two controller cases and bilingual HTTP tests cover elapsed/calendar units, leap boundaries, invalid/future dates, request-start time, repeated requests and timestamp preservation |
| Language isolation | Regional tags, quality weights, fallback, translated parser/schema/internal/authentication errors, stable machine fields and concurrent mixed-language requests passed |
| Repository mapping | Coordinate/bind order, typed output, total-count fallback, shared TTL and persistence-error propagation passed |
| HTTP and Swagger | Parser/schema behavior, invalid UTF-8 (plain/gzip), valid Unicode/BOM/UTF-16, examples, authentication, all four operations, Execute with editable language header, Persian output, snippets, duration, filtering, deep links and explicit read-only controls passed with isolated fake persistence |
| Production-only installation | A separate `npm ci --ignore-scripts --omit=dev` graph runs the updated compiled code, all four HTTP operations in both languages and authenticated English Swagger with fake persistence; English/Persian ICU support is verified and development tools are absent |
| Production migration availability | Migration CLI help executes from that production-only installation; no live migration was attempted |
| Development runner | tsx loads the TypeScript composition successfully |
| Compose configuration | Official checksum-verified Compose 5.6.1 validates the generated settings and application schema without a daemon; resolved service/volume settings remain equivalent to the prior VM profile |
| Credentials and packaging | Existing atomic generation, private modes, concurrency and overwrite/symlink protections pass; packaging tests verify supported paths, private export exclusions and checksums |
| Delivery checks | English documentation, internal links, JSON examples, shell syntax, source inventory, ZIP metadata/CRCs, executable modes, version consistency and checksum manifest checked |

HTTP tests use real temporary listeners and child processes, with fake repositories/health dependencies. DOM tests execute the actual bundled Swagger scripts using jsdom 30.1.3 installed outside the project. The compatibility checker also stays outside the deliverable. These checks do not execute PostGIS geography operations or establish browser rendering quality or capacity. See [Testing](TESTING.md) for reproducible suite commands.

## Dependency audit

Both full and production audit commands completed after the final dependency update and clean installation. Each reports zero known findings in all severity categories on the validation date. The preceding Zod and cron/UUID warnings are no longer reported by this graph. Contract validators and the development watcher are not production dependencies. See [Security](SECURITY.md) for scope and operational access boundaries.

This is an npm dependency snapshot, not a guarantee of zero application or image/OS vulnerabilities. Container and operating-system scans were not run.

## Remaining acceptance work

A Docker image build/startup for this updated artifact, real PostGIS migrations/integration/query plans, SQL performance/load tests and actual browser rendering were not executed in the review environment. No Docker daemon or native PostgreSQL/PostGIS installation was available, and no VM connection was configured. Production-only dependency checks run on the review host; they do not establish Alpine image execution. The skipped PostGIS suite is not a passed integration test.

After rebuilding on the VM, verify health, existing data, an authorized test upsert/search and Swagger login/Execute. Preserve `.env`, the Compose project name and the database volume. Follow [Deployment](DEPLOYMENT.md) and [Ubuntu VM deployment](VM_UBUNTU.md). Repository publication does not modify deployed configuration or a user database.

## Repository distribution

The repository stores the reviewed source, lockfile, tests and English guides at its root. README includes cloning, first deployment, API examples and development checks. [Contributing](../CONTRIBUTING.md), [Changelog](../CHANGELOG.md) and the [ISC license](../LICENSE) accompany the source and are included by the source packager. The existing package license identifier and application version are retained.

Only allowlisted release files are imported. Generated build output, installed dependencies, live environment files, local review tools and database exports are excluded. Executable shell/script modes and the regenerated checksum manifest are verified before publication. The checks above were run locally; they are not a claim of GitHub Actions execution.
