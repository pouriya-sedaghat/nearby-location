# Security and trust boundaries

[Documentation index](README.md) · [API](API.md) · [Privacy](PRIVACY_AND_RETENTION.md)

## Caller responsibilities

The service handles precise location data. Its bearer token establishes trusted service access but does not associate the request with an end user. The calling backend must authenticate the user, verify permission to publish the supplied `userId`, honor consent/visibility rules, and authorize disclosure of matched coordinates.

There is no tenant discriminator, per-user access-control list, consent field, or ownership binding in the database/query. `excludeUserId` removes one result; it is not an authorization mechanism. A shared service token grants access to its entire surface. Do not expose such credentials to untrusted browsers/devices.

## Authentication surfaces

| Surface | Configuration | Boundary |
|---|---|---|
| `/location/*` | `LOCATION_AUTH_MODE=bearer` and primary/optional previous token | Trusted location backend |
| `/metrics` | `METRICS_AUTH_MODE=bearer` and metrics token | Authorized scraper/operator |
| `/privacy/*` | `PRIVACY_API_ENABLED=true` and dedicated privacy token | Account/privacy control plane |
| `/api/docs/*` | Swagger enabled; dedicated username/password outside development | Documentation operator; separate HTTP Basic auth |
| `/health/*` | No application token | Restrict exposure through network/ingress as appropriate |

Use independent random credentials, at least 32 characters, and verified transport. Bearer tokens must be printable ASCII without spaces. Authentication runs before body parsing for protected API surfaces. Credential equality uses timing-safe comparisons; failures are non-enumerating 401 responses. See [rotation and rollout](OPERATIONS.md#credential-and-cursor-key-rotation).

Disabled location/metrics modes are compatibility/local defaults. Production must deliberately enable them or enforce an equivalent authenticated private service boundary. The privacy API always requires its dedicated token when enabled.

## Transport, proxies, and networking

The API listens with HTTP; the application does not terminate TLS. Provision verified TLS at the controlled gateway/service-mesh boundary and restrict direct API access. For database TLS use [the unambiguous configuration](CONFIGURATION.md#database), provision trust, and retain certificate verification.

`HTTP_TRUST_PROXY=true` sets Express's broad proxy trust flag. Only enable it when traffic necessarily arrives through controlled proxies that sanitize forwarding headers. The runtime does not support a configured trusted-hop/subnet list. With local IP-based rate limiting, an uncontrolled proxy path can spoof the client identity used by the limiter.

The example Kubernetes NetworkPolicy limits ingress by labels and TCP port; it does not isolate HTTP paths. Separate credentials and gateway policy protect privacy/metrics. The supplied policy has no egress rules. Add cluster-specific DB/DNS/monitoring requirements through your platform network process.

The production image runs non-root. Kubernetes and isolated evaluation examples use read-only root filesystems, dropped capabilities, and no privilege escalation; cluster examples avoid API token automount. Verify manifests and policy enforcement rather than assuming the templates alone establish controls.

## Input, SQL, and resource protection

Coordinate bounds, controlled ID characters, radius/page limits, safe offsets, cursor length, and a 32 KB JSON limit bound input. Parameterized SQL separates values from query structure. Foreground statements and connections have timeouts; cleanup uses separate transaction-local limits.

Concurrency/pool-pressure/circuit controls protect nearby/upsert, with optional adaptive limits. The optional rate limiter is local to a replica and keyed by IP/workload, not authenticated user. Privacy deletion uses its own drain/error handling and bypasses location admission, so apply control-plane network/gateway limits separately.

Client disconnect does not cancel database work. Capacity stays allocated until a handler finishes, and platform shutdown has a total deadline.

## Cursors and documentation

Signed cursors bind search context and protect sort/count/time metadata with HMAC-SHA256. Share keys across replicas and require signatures for a deliberate production policy. Cursor payloads are base64url text and may contain identifiers; they are readable, not encrypted. Avoid copying tokens into analytics or URLs that produce access logs.

Production Swagger defaults off. If enabled, use dedicated Basic credentials and view-only UI by default. Disabling Try it out only disables UI execution; it does not disable the API itself. The portable OpenAPI file documents optional features even when absent in the running service.

## Logging and secrets

The application logs normalized routes rather than raw URLs, and omits request bodies. Production error messages/stacks are suppressed; sensitive named fields are recursively redacted. Do not add raw query parameters, IDs, coordinates, tokens, cursors, or SQL diagnostics to logging. Database/gateway/APM collection can still expose data and requires independent review.

Store secrets outside Git and release archives. Example files document shape only. Source packaging excludes known environment/Secret files but is not a general secret scanner; review the full working tree before packaging. Kubernetes environment secrets require a rollout to take effect. Restrict administrative DB access and prefer separate runtime/migration identities after adapting deployment wiring.

For dependency changes, retain a reproducible lockfile and inspect CI audit results for the exact release. The CI audit is a validation step, not a permanent vulnerability status.

## Before production

Confirm caller authorization, verified transport, secret ownership/rotation, protected scrapes/privacy/docs, safe proxy headers, network controls, sensitive-log handling, retention, backup policy, and incident routing. Record concrete environment evidence in [production acceptance](PRODUCTION_READINESS.md). Use [the location incident runbook](runbooks/LOCATION_PRIVACY_INCIDENT.md) for exposure or compromised credentials.

Source: [auth middleware](../src/middleware/auth.middleware.ts), [auth utility](../src/utils/auth-core.ts), [Swagger auth](../src/middleware/swagger-auth.middleware.ts), [app](../src/app.ts), [logger](../src/utils/logger.ts), [deployment manifests](../deploy/kubernetes).


## Installation and release controls

Docker, CI and documented installs use `npm ci --ignore-scripts`; the reviewed graph does not require dependency install hooks. Explicit project builds, tests, migrations and runtime commands still run. Production images use locked production dependencies and the built-in non-root Node user, without compiler or PostgreSQL client tooling.

Body decoding verifies UTF-8 and UTF-16 before identifier validation, including compressed input. Per-request language selection does not mutate global validator locale; response keys and machine codes stay stable. HTTP metric methods/routes are normalized to bounded values. Release image and namespace inputs are validated before YAML rendering or cluster changes. The source packager uses an explicit allowlist and rejects supported-path symlinks, while excluding live secrets, exports and build output.

See [Release review](REVIEW_2.14.1.md) for the dated dependency audit, executed tests and remaining acceptance work.
