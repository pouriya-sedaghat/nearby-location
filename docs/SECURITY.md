# Security and access boundaries

[Documentation index](../README.md)

## API access

The four existing routes and their access model are preserved. Location endpoints do not authenticate callers or bind `userId` to a verified identity. A caller allowed through the deployment network can write that identifier's location. Nearby responses include stored coordinates; `excludeUserId` is a result filter, not authorization.

Use the company's authenticated gateway/access layer for caller identity, identifier ownership, read permission and traffic limits. The supplied Compose mapping exposes HTTP only at VM loopback; the database has no published host port. Swagger Basic Auth protects documentation only. See [Ubuntu VM deployment](VM_UBUNTU.md) for the private SSH tunnel and gateway connection.

## Credentials and configuration

The single private `.env` is generated with independent database and documentation passwords and mode `0600`. The initializer refuses existing files, directories and symlinks, publishes a completed file atomically, and does not print credentials. The shipped `.env.example` contains empty passwords. Keep the existing `.env` and database role password together across restarts and upgrades.

Direct execution requires a valid PostgreSQL `DATABASE_URL`; there is no built-in credential fallback. Validation rejects malformed URIs without printing their supplied contents. Use URL-encoded credentials and keep TLS options consistent. With explicit `PG_SSL=true`, certificate verification defaults to enabled. URL/driver TLS options can also affect the connection; see [Configuration](CONFIGURATION.md).

The source packager accepts explicit release paths and supported formats; unrelated exports, private environment files and key formats are excluded. Docker's build-context allowlist includes only required build/runtime inputs. These controls do not detect a secret manually written inside a legitimate source file. Review source before release and keep location dumps outside the source tree in protected storage.

Docker administrators can inspect container environments. The Compose bootstrap role remains the database owner used for migration/runtime connections, preserving the existing VM database. Companies requiring separate restricted roles must plan and validate those privileges with their database administrator. No existing role, ownership or stored credential is silently changed by this source refactor.

## Documentation authentication

Enabled documentation outside development requires a paired dedicated username/password; passwords are 32-256 printable non-space ASCII characters. Development also requires login when the pair is configured. Use Basic Auth only over HTTPS or the protected tunnel.

The middleware protects the UI, its assets and live specification and sends no-store, nosniff and noindex headers. Comparisons use fixed-length hashes and timing-safe equality. UI authorization persistence and external validation are disabled. UI initialization options are isolated per app instance, so another instance cannot alter its execution settings. Express's framework version header is disabled.

## Input and error handling

Schemas validate identifiers, coordinates, radius and safe pagination. Malformed Unicode and NUL identifiers are rejected. Raw UTF-8 is verified before permissive decoding can collapse distinct malformed byte sequences into one identifier; this also applies after gzip decompression. Valid Unicode and the supported UTF-16 transports remain accepted. JSON parsing retains the 32 KiB limit, including decompressed JSON. Queries bind values instead of interpolating user input. Search and cleanup share the repository TTL.

Validation preserves the public `_errors` tree and documented default English messages, with Persian translations selected through `Accept-Language`. Detailed library-generated field wording may differ after a validator update; clients should use HTTP status, field paths and response structure rather than parsing translated strings. Parser and internal responses do not echo submitted bodies or database errors. Language and the reference clock are request-local; no client timestamp is trusted and no global validator locale is changed. `Vary: Accept-Language` distinguishes language variants in shared caches. Operational logs still require restricted access.

## Dependency audit

Docker builds and documented local installs use `npm ci --ignore-scripts`. The locked graph works without dependency install hooks, so these hooks, including optional installation telemetry, do not run. Build, test, start and migration commands remain explicit project operations. If a future dependency requires an install hook, review that requirement before changing the installation policy. See [npm ci configuration](https://docs.npmjs.com/cli/v11/commands/npm-ci/#ignore-scripts).

Audit snapshot on `2026-10-25`, after a clean locked install:

| Audit scope | Critical | High | Moderate | Low | Total |
| --- | --- | --- | --- | --- | --- |
| Full dependency graph | 0 | 0 | 0 | 0 | 0 |
| Production dependencies | 0 | 0 | 0 | 0 | 0 |

The graph now uses Zod 4.6.7 and node-cron 4.6.0. Compatibility and lifecycle tests cover the library migrations. The production graph includes the migration CLI as an explicit runtime dependency and excludes the TypeScript toolchain, development watcher and contract validators. Swagger no longer needs an annotation parser. Development uses tsx; type definitions match Node.js 24 and Express 4.

An audit result describes advisories known to the registry for this dependency graph at that time. It does not establish zero application, operating-system or container-image vulnerabilities. No container/OS vulnerability scan was run in this environment. Refresh during release validation:

```bash
npm audit
npm audit --omit=dev
```

Technical references:

- [Zod migration guide](https://zod.dev/v4/changelog)
- [Node-cron task lifecycle](https://www.nodecron.com/api-reference.html)
- [Docker build practices](https://docs.docker.com/build/building/best-practices/)
