# API reference

[Documentation index](../README.md)

## General rules

Examples use `http://localhost:8080`. Location requests use POST with `Content-Type: application/json`. The JSON parser limit is 32 KiB. Main endpoint responses are JSON and contain `success`.

The service has no built-in location authentication. Identifier ownership must be checked by the access layer; see [Security](SECURITY.md).

| Method and path | Input | Successful result |
| --- | --- | --- |
| `POST /location/upsert` | Identifier and coordinates | 200; stores one current location |
| `POST /location/nearby` | Center and options | 200; results and pagination metadata |
| `GET /health/live` | None | 200; `status: "ok"` |
| `GET /health/ready` | None | 200; `status: "ready"` |

## Response language

Set the standard `Accept-Language` request header to `en` or `fa`. Missing or unsupported preferences fall back to English. Regional tags such as `fa-IR` and quality weights such as `fa;q=0.9,en;q=0.5` are supported. Language is selected independently for each request; there is no global locale, saved user preference, query option or environment setting.

Success messages, error messages, validation details and `updateStatus` use the selected language. JSON keys, field paths, identifiers, numeric values, booleans, HTTP status codes, health status codes and ISO timestamps remain unchanged. The response includes `Content-Language: en` or `fa`, and `Vary: Accept-Language`. Shared caches must retain this variation. Documentation and operational logs stay in English.

```bash
curl -fsS http://localhost:8080/location/nearby \
  -H 'Content-Type: application/json' \
  -H 'Accept-Language: fa' \
  --data '{"coordinate":{"lat":35.6892,"lng":51.389}}'
```

Illustrative localized display text for the same stored timestamp and server reference instant:

```json
{"en":"1 minute ago","fa":"۱ دقیقه پیش"}
```

The object above compares display strings; the actual nearby response retains its normal `data[].updateStatus` field. A successful upsert with `Accept-Language: fa` returns:

```json
{"success":true,"message":"موقعیت با موفقیت ذخیره شد"}
```

## Coordinates and identifiers

| Field | Type | Constraint |
| --- | --- | --- |
| `coordinate.lat` | number | WGS84 latitude from -90 to 90, inclusive |
| `coordinate.lng` | number | WGS84 longitude from -180 to 180, inclusive |
| `userId` / `excludeUserId` | string | Trimmed; 1-255 UTF-16 code units after trimming; well-formed Unicode with no NUL characters |

Coordinates must be JSON numbers; numeric strings are not accepted for `lat` or `lng`. The longitude field is named `lng`. The database determines the update timestamp; client-supplied timestamps are not part of the contract.

## Create or update

`POST /location/upsert`

Request:

```json
{
  "userId": "demo-user",
  "coordinate": {"lat": 35.6892, "lng": 51.389}
}
```

Both `userId` and `coordinate` are required. The first write inserts a row. Subsequent writes for that identifier update coordinates and `updated_at`, preserving `created_at`.

Response, status 200:

```json
{"success":true,"message":"Location upserted successfully"}
```

The endpoint does not return the stored row.

## Nearby search

`POST /location/nearby`

```json
{
  "coordinate": {"lat": 35.6892, "lng": 51.389},
  "maxDistance": 5000,
  "excludeUserId": "requester",
  "page": 1,
  "pageSize": 10
}
```

| Field | Required | Default | Constraint |
| --- | --- | --- | --- |
| `coordinate` | Yes | None | Search-center coordinate object |
| `maxDistance` | No | `DEFAULT_MAX_DISTANCE_METERS`, normally 10000 | Greater than zero; at most `MAX_MAX_DISTANCE_METERS`; meters |
| `excludeUserId` | No | No exclusion | Omits one identifier |
| `page` | No | 1 | Positive integer up to `9007199254740991`; computed offset must also be safe |
| `pageSize` | No | 10 | Integer 1-100 |

Options may be provided in the query or body. A body field overrides the entire query field of the same name. Precedence is shallow; coordinate components are not merged individually. Send coordinates in the JSON body for the standard request form.

```bash
curl -sS -X POST \
  'http://localhost:8080/location/nearby?maxDistance=5000&page=2&pageSize=5' \
  -H 'Content-Type: application/json' \
  --data '{"coordinate":{"lat":35.6892,"lng":51.389},"maxDistance":1000}'
```

The effective radius is 1000 meters, page is 2, and pageSize is 5. Numeric strings are accepted for `maxDistance`, `page`, and `pageSize`. Booleans, arrays, objects, null, and blank or whitespace-only strings are rejected.

### Selection and ordering

A candidate must be inside the inclusive radius, fresh under the configured TTL, and different from `excludeUserId`. Freshness follows:

```sql
updated_at >= now() - make_interval(days => LOCATION_TTL_DAYS)
```

This illustrative expression uses `LOCATION_TTL_DAYS` to represent the configured value. Executable SQL uses a bind parameter.

Results are ordered by the following score descending, then by `user_id` ascending:

```text
score = 1 / (distance + 1) + (epoch_seconds(updated_at) * 1000) / 1e10
```

Ordering is therefore not distance-only. `distance` is measured from the requested center to the stored location, in meters. The requester may appear unless `excludeUserId` is sent.

### Response

Illustrative status-200 response. Relative time depends on the application clock:

```json
{
  "success": true,
  "page": 1,
  "pageSize": 10,
  "totalCount": 1,
  "totalPages": 1,
  "hasMore": false,
  "data": [
    {
      "userId": "demo-user",
      "coordinate": {"lat": 35.6892, "lng": 51.389},
      "distance": 0,
      "updatedAt": "2026-10-14T00:00:00.000Z",
      "updateStatus": "5 minutes ago"
    }
  ]
}
```

| Response field | Meaning |
| --- | --- |
| `page`, `pageSize` | Effective values after validation and defaults |
| `totalCount` | All candidates matching radius, TTL, and exclusion |
| `totalPages` | `ceil(totalCount / pageSize)` |
| `hasMore` | `page < totalPages` |
| `data[].coordinate` | That user's stored coordinates |
| `data[].distance` | Calculated distance in meters |
| `data[].updatedAt` | Stored timestamp serialized to ISO format |
| `data[].updateStatus` | English or Persian display text selected by `Accept-Language` |

When no candidates match, `totalCount` and `totalPages` are zero, `hasMore` is false, and `data` is empty. A page beyond the last page also returns 200 with `data: []`; a fallback query calculates the matching count.

The offset is `(page - 1) * pageSize`. Separate pages do not share a snapshot. Concurrent writes can change ordering or counts in later requests.

### Relative display age

`updatedAt` is the exact database timestamp for calculations. On every request, the server captures its current time before body parsing or database work, then recalculates `updateStatus` from the difference between that reference and each stored `updatedAt`. One reference instant is shared by the entire response; database latency and per-row processing do not change it. The age is never stored and no client clock is trusted. A later request recomputes it from the original stored timestamp. An already received JSON response does not update itself; a client that needs a continuously changing label must refresh it or format `updatedAt` locally.

The display uses cached native `Intl.RelativeTimeFormat` formatters for English and Persian. Language affects wording and display digits, with identical unit thresholds in both languages. Calendar months and years follow the UTC Gregorian calendar in both languages, including Persian; localization does not change the calendar.

| Age unit | Selection and calculation |
| --- | --- |
| Seconds | Below 60 seconds; completed seconds |
| Minutes | Below 60 minutes; completed minutes |
| Hours | Below 24 hours; completed hours |
| Days | Below 7 elapsed days; each day is 24 hours |
| Weeks | At least 7 elapsed days, before the first complete UTC calendar month |
| Months | Completed UTC calendar months, before 12 completed months |
| Years | Completed UTC calendar years, from 12 completed months onward |

Month/year anniversaries preserve the stored UTC time of day and clamp an unavailable day to the destination month's last day. For example, January 31 to February 28 at the same UTC time is one month in a non-leap year. A February 29 anniversary falls on February 28 in a non-leap year. These units do not assume that every month has 30 days or every year has 365 days.

Examples include `1 minute ago`, `2 hours ago`, `1 month ago` and `1 year ago`. Future timestamps retain `0 seconds ago`. Invalid stored timestamps produce the generic internal error rather than a misleading `NaN` display. Server timezones and daylight-saving transitions do not change the UTC calendar policy. The display text is not a precise duration or a value for client arithmetic.

## Health

```json
{"success":true,"status":"ok"}
```

The response above belongs to `GET /health/live`. Readiness executes `SELECT 1` through the pool:

```json
{"success":true,"status":"ready"}
```

On a database error, readiness returns 503:

```json
{"success":false,"status":"not_ready"}
```

Readiness does not check table existence or spatial query correctness. Verify an upsert and nearby request after deployment.

## Errors

| Status | Condition | Message or structure |
| --- | --- | --- |
| 400 | Invalid upsert fields | `Invalid request body` with `errors` |
| 400 | Invalid nearby fields | `Invalid request data` with `errors` |
| 400 | Malformed JSON, malformed UTF-8 or corrupt compressed JSON | `Invalid JSON body` |
| 401 | Invalid documentation credentials | `Unauthorized` with a Basic challenge header |
| 404 | Unknown route or disabled Swagger | `Not found` |
| 413 | JSON exceeds the parser limit | `Request body too large` |
| 415 | Unsupported charset or content encoding | `Unsupported request body encoding` |
| 500 | Location controller error | `Internal server error` |
| 500 | General middleware error | `Internal Server Error` |
| 503 | Readiness query failure | `status: "not_ready"` |

Validation example for an empty `userId`; wording and structure follow the current schema:

```json
{
  "success": false,
  "message": "Invalid request body",
  "errors": {
    "_errors": [],
    "userId": {"_errors": ["User id cannot be empty"]}
  }
}
```

The table and validation example above show default English wording. With `Accept-Language: fa`, human-readable messages and `_errors` entries are translated while field names and structure remain unchanged. Parser errors do not echo the request body. `errors` is present only for schema validation failures. Validator-generated field details may change between dependency versions. Clients should use the HTTP status and response structure when handling failures.

## OpenAPI and Swagger

[openapi.json](openapi.json) is generated from the code definitions and can be imported into API tools. Its canonical radius default/maximum values are 10000/100000, and `servers[0].url` is `/`. For configuration-specific values, retrieve `/api-docs/openapi.json` from the running environment when documentation is enabled.

The OpenAPI 3.0.3 contract includes unique operation IDs, reusable request/response schemas, seven named request examples, and success/error examples for every documented response. Readiness success and 503 failure have distinct schemas. Radius defaults and limits are shared by body and query definitions. Safe-offset calculation, trimming/Unicode length and shallow precedence remain runtime rules. Numeric schemas describe canonical input; numeric-string acceptance is documented in their descriptions. Apply the rules on this page when validating clients.

The UI enables Execute by default when documentation is exposed. The [interactive Swagger guide](SWAGGER.md) covers the console workflow, query/body precedence, deployment settings and troubleshooting.
