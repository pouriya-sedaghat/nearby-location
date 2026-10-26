# API contract

[Documentation index](README.md) · [OpenAPI JSON](openapi.json) · [Security](SECURITY.md)

## Conventions

Default application port: **8080**. Location and privacy commands use JSON over HTTP POST. Coordinates are WGS84 decimal degrees; distances and radii are meters. Timestamps serialize as ISO date-time strings. Responses include `x-request-id`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

The service accepts a supplied request ID matching `[A-Za-z0-9._-]{1,128}` or generates a UUID. Use it for correlation without embedding user identifiers. JSON parsing has a 32 KB limit. Upsert and nearby schemas strip unknown object fields. Normalized erasure rejects `match` and strips other unknown fields; exact erasure rejects every unknown field. Unknown fields are never persisted.

The examples below use `http://localhost:8080` and a protected service with `LOCATION_AUTH_TOKEN` supplied securely in the shell environment. Local development permits omitting the Authorization header when location authentication is disabled.

## Endpoints

| Method | Path | Success | Authentication / availability |
|---|---|---|---|
| POST | `/location/upsert` | 200 JSON | Location bearer token when enabled |
| POST | `/location/nearby` | 200 JSON | Location bearer token when enabled |
| POST | `/privacy/location/delete` | 204, empty body | Optional route; dedicated privacy bearer token; normalized identifier |
| POST | `/privacy/location/delete-exact` | 204, empty body | Optional route; dedicated privacy bearer token; exact stored identifier; 404 on builds without this route |
| GET | `/health/live` | 200 JSON | No application authentication |
| GET | `/health/ready` | 200 JSON or 503 | No application authentication |
| GET | `/metrics` | 200 Prometheus text | Metrics bearer token when enabled |
| GET | `/api/docs/` | Swagger UI | Optional; Basic authentication outside development |
| GET | `/api/docs/openapi.json` | Runtime OpenAPI JSON | Same documentation authentication |

Tokens identify a trusted service, not the end user. `userId` and `excludeUserId` do not establish ownership or permission to see another user's coordinates.

## Publish a location

```bash
curl --fail-with-body http://localhost:8080/location/upsert \
  -H "Authorization: Bearer $LOCATION_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"demo_user","coordinate":{"lat":35.6892,"lng":51.389}}'
```

```json
{"success":true,"message":"Location upserted successfully"}
```

| Field | Rules |
|---|---|
| `userId` | String; trimmed, 1–255 UTF-16 code units (`String.length` in JavaScript); well-formed Unicode (lone UTF-16 surrogates are rejected because UTF-8 storage would turn distinct IDs into the same U+FFFD value); control characters U+0000–U+001F and U+007F–U+009F are rejected |
| `coordinate.lat` | JSON number from −90 through 90 |
| `coordinate.lng` | JSON number from −180 through 180 |

An astral Unicode character such as an emoji occupies two UTF-16 code units; the limit is not a count of displayed characters or UTF-8 bytes. Coordinate numeric strings are rejected. Upsert creates one current location or replaces the existing position. PostgreSQL supplies `updated_at`; the client cannot supply an observation timestamp. The original `created_at` is preserved. Repeating an upsert refreshes freshness even when coordinates do not change.

## Nearby search

```bash
curl --fail-with-body http://localhost:8080/location/nearby \
  -H "Authorization: Bearer $LOCATION_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"coordinate":{"lat":35.6892,"lng":51.389},"maxDistance":5000,"excludeUserId":"requesting_user","pagination":"cursor","pageSize":10}'
```

| Field | Default | Rules |
|---|---|---|
| `coordinate` | Required | Same numeric coordinate rules as upsert; use a body object |
| `maxDistance` | 10,000 | Positive finite number; default maximum 100,000; both values configurable |
| `excludeUserId` | Omitted | Same ID rules as upsert; excludes exactly one user |
| `pagination` | `offset` | `offset` or `cursor`; supplying `cursor` also selects cursor mode |
| `page` | 1 in offset mode | Positive safe integer; resulting offset must be safe; forbidden in cursor mode |
| `pageSize` | 10 | Integer from 1 through 100 |
| `cursor` | Omitted | Trimmed opaque string from 1 through 2,400 characters. Every cursor the service emits fits: the worst case, a signed decay cursor for a 255-character stored identifier of escaped control characters, is 2,389 characters |

Pagination, radius, and exclusion fields may appear in the query or body. A body field wins when both supply the same name. Numeric strings are accepted for pagination/radius, including in the body, while booleans, arrays, objects, and blank numeric strings are rejected. `coordinate` components must remain JSON numbers.

`cursor` cannot be combined with `page` or `pagination=offset`. No explicit cursor is needed to request the first cursor page.

The radius uses the inclusive `ST_DWithin` geography predicate. TTL filtering runs independently of physical cleanup: legacy uses the current database clock, while decay uses its pinned reference clock. A decay continuation can therefore include rows that have expired relative to the current clock but were eligible at its reference time. Results sort by internal ranking score descending, then user ID ascending, rather than by distance alone. Ranking mode is an environment setting, not a request field.

## Response shapes

An illustrative offset response:

```json
{
  "success": true,
  "paginationMode": "offset",
  "rankingMode": "legacy",
  "page": 1,
  "pageSize": 10,
  "totalCount": 1,
  "totalPages": 1,
  "hasMore": false,
  "nextCursor": null,
  "data": [
    {
      "userId": "demo_user",
      "coordinate": { "lat": 35.6892, "lng": 51.389 },
      "distance": 0,
      "updatedAt": "2026-10-12T08:00:00.000Z",
      "updateStatus": "1 minute ago"
    }
  ]
}
```

Time/age values are illustrative. A cursor response contains the same result objects but omits `page` and `totalPages`:

```json
{
  "success": true,
  "paginationMode": "cursor",
  "rankingMode": "legacy",
  "pageSize": 10,
  "totalCount": 0,
  "hasMore": false,
  "nextCursor": null,
  "data": []
}
```

| Response field | Meaning |
|---|---|
| `paginationMode` | Effective pagination method |
| `rankingMode` | Configured server ranking profile mode |
| `totalCount` | Match count; verified signed v3 continuation reuses the original count |
| `totalPages` | `ceil(totalCount / pageSize)`; offset responses only |
| `hasMore` | More rows/pages were detected for this response |
| `nextCursor` | Opaque continuation token or `null`; offset responses can also offer a cursor |
| `data[].userId` | Matched user identifier |
| `data[].coordinate` | Matched user's stored position, not an echo of the search center |
| `data[].distance` | Unrounded PostGIS geography distance from the search center in meters |
| `data[].updatedAt` | Database update timestamp |
| `data[].updateStatus` | English or Persian display age calculated at request start |

Internal `score`, primary key, and `created_at` are omitted. An offset beyond the final page returns empty `data` while preserving the match count. A terminal page has `hasMore=false` and `nextCursor=null`.

## Cursor traversal

1. Request `pagination=cursor` without a cursor.
2. If `nextCursor` is non-null, send it with the same coordinate, radius, and exclusion. Omit `page`. Page size may change.
3. Continue until `nextCursor=null`; restart from the first page after a cursor validation or expiration failure.

A JavaScript traversal for a protected service:

```javascript
const search = {
  coordinate: { lat: 35.6892, lng: 51.389 },
  maxDistance: 5000,
  pagination: "cursor",
  pageSize: 20,
};
let cursor;
do {
  const response = await fetch("http://localhost:8080/location/nearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LOCATION_AUTH_TOKEN}`,
    },
    body: JSON.stringify({ ...search, ...(cursor ? { cursor } : {}) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Nearby HTTP ${response.status}`);
  const page = await response.json();
  // Apply the caller's disclosure policy before displaying page.data.
  cursor = page.nextCursor;
} while (cursor);
```

New v3 sessions expire after `CURSOR_MAX_AGE_MINUTES` (default 60); advancing pages does not renew their issuance time. Invalid/tampered tokens, query mismatches, changed decay profiles, expired sessions, and timestamps beyond the five-minute future allowance return 400.

Configure the same signing keys across replicas. Signing prevents forgery but does not encrypt identifiers inside a cursor. Treat tokens as sensitive and avoid logging them.

**Consistency:** signed v3 counts reflect session start. Decay uses a fixed ranking clock, but the live table can change through upserts/deletion/cleanup. A cursor session is not a cross-request snapshot. Avoid promising exact-once enumeration of a changing population.

## Erase a current location

Both routes are mounted only when `PRIVACY_API_ENABLED=true`. Each requires the dedicated privacy token.

```bash
curl --fail-with-body -i http://localhost:8080/privacy/location/delete \
  -H "Authorization: Bearer $PRIVACY_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"demo_user"}'
```

Two routes erase a live location. Each request deletes at most one stored identity, and neither route falls back to the other.

| Route | Identifier handling | Use for |
|---|---|---|
| `POST /privacy/location/delete` | Upsert rules: trimmed; 1–255 UTF-16 code units; well-formed Unicode; control characters rejected with 400, never trimmed away. A `match` field is rejected with 400 | The identifier the caller published; deletes the row an upsert of the same input writes |
| `POST /privacy/location/delete-exact` | Byte-for-byte, no trimming; nonblank, 1–255 UTF-16 code units, well-formed Unicode, no NUL; other control characters allowed. Unknown fields are rejected with 400 | A `userId` returned by a nearby response, or identifiers stored under older rules (for example control characters before 2.13.1) |

```bash
curl --fail-with-body -i http://localhost:8080/privacy/location/delete-exact \
  -H "Authorization: Bearer $PRIVACY_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":" legacy_user"}'
```

With both `" padded"` and `"padded"` stored, `delete-exact` with `{"userId":" padded"}` deletes only `" padded"`, while the normalized route with the same body deletes `"padded"`, exactly as upsert would have addressed it. With both `"\tuser"` and `"user"` stored, the normalized route rejects `{"userId":"\tuser"}` and deletes nothing.

Exact erasure is a separate route because the pre-fix 2.13.5 build at `014d80e` silently drops unknown fields: a `match` selector sent there still performs normalized deletion. Builds without `delete-exact` answer **404 and delete nothing**. Version 2.14.0 includes the exact-erasure route; identify deployed binaries by commit/image digest as well as package version. Normalized erasure preserves trimming for valid IDs, but now also rejects ill-formed Unicode and `match`. Treat any 404 from `delete-exact` as "not performed" and retry with backoff until a replica that supports it answers; never retry the request on the normalized route. See [rolling out exact erasure](OPERATIONS.md#rolling-out-exact-erasure).

Success is **204 with no response body**, whether the row existed or not. It is a hard deletion of live state. Stop publishing and drain delayed/retried events before invoking it; future upserts can recreate the row. See [the complete erasure workflow](PRIVACY_AND_RETENTION.md#explicit-erasure).

## Probes and metrics

```bash
curl --fail http://localhost:8080/health/live
curl --fail http://localhost:8080/health/ready
curl --fail http://localhost:8080/metrics \
  -H "Authorization: Bearer $METRICS_AUTH_TOKEN"
```

Liveness returns `{"success":true,"status":"ok"}`. Readiness returns `{"success":true,"status":"ready","circuit":"closed"}` when ready and PostgreSQL responds; the actual circuit field may be `closed`, `half_open`, or `open`. Not-ready responses return 503 and `status: "not_ready"`. The lifecycle reason is included when lifecycle prevents readiness, but not necessarily on a database failure.

Metrics are Prometheus exposition text, not JSON. See [operations](OPERATIONS.md#metrics-and-alerts).

## Errors and retries

Error bodies have `success:false` and `message`. Schema failures also include Zod-formatted `errors`; cursor failures use a message without that field.

```json
{"success":false,"message":"Invalid cursor"}
```

| Status | Cause | Caller action |
|---|---|---|
| 400 | Invalid data/JSON, unsafe pagination, invalid or expired cursor | Correct request or restart traversal |
| 401 | Missing/invalid credentials on a protected surface | Supply the correct surface token |
| 404 | Unknown route or disabled optional endpoint | Check feature configuration and path |
| 413 | JSON body too large | Reduce payload |
| 415 | Unsupported body encoding/charset | Use supported JSON encoding |
| 429 | Optional per-replica IP/workload rate limit | Honor `Retry-After`; apply bounded backoff |
| 503 | Drain, admission pressure, transient DB error, or not-ready probe | Honor `Retry-After` if present; retry within a caller budget |
| 500 | Unexpected internal failure | Correlate request ID and investigate |

Controlled location rejections expose `X-Nearby-Rejection-Reason`: `draining`, `rate_limit`, `concurrency`, `pool_queue`, `circuit_open`, or `db_retryable`. They also expose `Retry-After`; drain responses use `Connection: close`. Privacy transient failures provide retry guidance without the location rejection-reason header. Not every 503 has those headers.

Retries should use jitter, a deadline, and a finite attempt count. Repeating an upsert can safely target the same user row, but it refreshes `updated_at`. Privacy erasure is idempotent on both routes; a 404 from `delete-exact` means the erasure was not performed.

## Response language and relative-time display

Use `Accept-Language: en` (default) or `Accept-Language: fa`. Regional tags and quality weights are supported, with English fallback for unsupported preferences. `Content-Language` reports the selection and `Vary` includes `Accept-Language`. Human messages, validation details and display ages are localized. Keys, identifiers, cursor payloads, numeric values, health/error codes and ISO timestamps are unchanged. Documentation, logs and Prometheus exposition stay in English.

```json
{"en":"1 minute ago","fa":"۱ دقیقه پیش"}
```

The example compares display strings; nearby responses retain their normal `data[].updateStatus` field. Age is calculated from stored `updatedAt` using one trusted server instant captured at request start, before parsing or database work. It is not stored or based on client time. Later requests recalculate it; a received JSON response does not update itself.

| Age | Unit |
|---|---|
| Below 60 seconds | Completed seconds, including zero |
| Below 60 minutes | Completed minutes |
| Below 24 hours | Completed hours |
| Below 7 elapsed days | Completed 24-hour days |
| From 7 days until the first complete UTC calendar month | Completed weeks |
| From 1 through 11 complete calendar months | Months |
| From 12 complete calendar months | Completed years |

Both languages use UTC Gregorian calendar anniversaries, preserving time of day and clamping missing days to month end. January 31 to February 28 at the same time is one month in a non-leap year. This avoids fixed 30-day/365-day approximations. Future timestamps show zero age; invalid stored timestamps fail as a generic internal error. Use exact `updatedAt` for arithmetic.

## Swagger and OpenAPI

`SWAGGER_ENABLED` controls route mounting; `SWAGGER_TRY_IT_OUT_ENABLED` controls UI execution. Both default to true in development and false otherwise. Outside development, enabled docs require `SWAGGER_AUTH_USERNAME` and a separate password of at least 32 characters. Basic documentation credentials are independent of API bearer tokens.

Use the browser's documentation login, then choose Swagger **Authorize** and enter the relevant bearer token without the `Bearer` prefix. Execution is available only when enabled. Keep production UI view-only unless an operator has a concrete need to execute requests.

The committed [OpenAPI file](openapi.json) describes all features and configured generation defaults. The live `/api/docs/openapi.json` reflects enabled privacy routes, current authentication, and runtime radius settings. `BASE_URL` changes the OpenAPI server URL; it does not move Express routes or configure proxy rewriting.

Regenerate deterministically with `npm run docs:api`. CI checks for drift. See [development maintenance](DEVELOPMENT.md#maintain-the-documentation).

Source: [routes](../src/routes), [schemas](../src/schemas/request.schema.ts), [controllers](../src/controllers), [OpenAPI builder](../src/config/swagger.ts).
