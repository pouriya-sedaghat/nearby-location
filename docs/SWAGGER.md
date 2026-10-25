# Interactive Swagger guide

[Documentation index](../README.md)

Swagger UI is an executable API console for the four existing operations. It loads the running process's OpenAPI 3.0.3 contract, including configured radius defaults and limits. The application version remains `1.0.0`.

## Start and open

For the default VM deployment, start the stack using [Getting started](GETTING_STARTED.md), then check it from the project root:

```bash
sudo docker compose ps
curl -fsS http://127.0.0.1:8080/health/ready
```

Swagger and Execute are enabled by the included Compose configuration. From your workstation, substitute the VM's SSH user and address:

```bash
ssh -N -L 8080:127.0.0.1:8080 vm-user@VM_IP
```

Open `http://127.0.0.1:8080/api-docs/`. Use `docs_operator` and the generated `SWAGGER_AUTH_PASSWORD` from the VM's `.env`. Keep the existing configuration for restarts and upgrades; no additional password generation is needed. If `PORT` was changed, update both the tunnel and browser URL. Basic Auth requires HTTPS or a protected tunnel.

For optional direct Node execution, configure a separately reachable PostGIS database and apply migrations as described in [Deployment](DEPLOYMENT.md). `npm run dev` enables documentation by default; `npm start` uses validated runtime settings with a production default. The application default outside development is disabled, while the supplied Compose configuration explicitly enables authenticated documentation.

`SWAGGER_TRY_IT_OUT_ENABLED=false` disables execution in the UI. To restore it, set the value to `true` in `.env` and recreate the Compose application with `sudo docker compose up -d --wait --wait-timeout 180`; for direct execution, restart the process. Setting changes do not modify the database connection.

## Execute a complete workflow

Confirm the selected server before executing. With the default `BASE_URL=/`, requests use the same origin as the documentation. Upsert performs a real database write.

1. Expand **Check process liveness** (`getLiveness`) and click **Execute**. Expect HTTP 200 with `status: "ok"`.
2. Expand **Check database connectivity** (`getReadiness`) and execute. Expect 200 with `status: "ready"`. A database connection failure returns 503 with `status: "not_ready"`.
3. Expand **Create or update a user's location** (`upsertLocation`). Select **Create a test location in Tehran**, keep or edit the JSON identifier, and execute. Expect 200 with `Location upserted successfully`.
4. Expand **Search fresh nearby locations** (`findNearbyUsers`). Keep **Search center only (use query controls)** and execute. With the example center unchanged, the fresh test location should appear at zero distance.
5. Set the optional query input `excludeUserId` to your test identifier and execute again. That identifier should be omitted. Clear this input to include it again.
6. To test an update, select **Update the same test user** in the upsert operation and execute. Subsequent searches return the updated stored coordinates.

The UI opens operations with Try it out active. If you cancel it, click **Try it out** again before executing. A live **Server response** and status code confirm execution; the response examples listed beneath are static illustrations.

## Console controls

| Control | Purpose |
| --- | --- |
| Tag and operation filter | Narrow the list, for example by `Health` or `Location` |
| Operation ID and deep link | Identify and link directly to one operation |
| Request example selector | Load one of seven valid named request bodies |
| JSON editor and query inputs | Change the request before Execute |
| Server selector | Display/select the configured request destination |
| Request snippets | Copy generated cURL for bash, PowerShell or CMD |
| Live server response | Inspect actual HTTP status, JSON and headers |
| Request duration | Inspect elapsed request time in milliseconds |
| Example Value / Schema | Inspect illustrative responses and reusable field definitions |

Named response examples cover successful writes, matches, no matches, pages beyond the result range, validation/parser errors, oversized bodies, unsupported encodings, internal errors and health states. Twenty-four reusable examples support the contract, including four Persian response examples. Response timestamps and age strings are illustrative.

## Response language

Each operation exposes an optional `Accept-Language` header input. Keep `en` for English or enter `fa` for Persian, then execute. Regional tags and quality weights are accepted; unsupported or missing preferences fall back to English. Inspect `Content-Language` and `Vary` in the live response headers. Messages, validation details and `updateStatus` follow the selected language; keys, numbers, status codes and ISO timestamps remain unchanged. The UI and its descriptive text stay in English. Changing a static response example does not change the request language; use the header input. See [API response language](API.md#response-language).

## Query inputs and JSON precedence

Body fields override query fields with the same name. Use the default center-only search example when editing radius, pagination or exclusion in query inputs:

```json
{"coordinate":{"lat":35.6892,"lng":51.389}}
```

If you select the explicit-options example, its body `maxDistance`, `page` and `pageSize` win over the corresponding query controls. Remove a body option to use its query value. The optional exclusion query starts empty, so the demonstration user is not silently excluded.

Coordinates must be JSON numbers in WGS84 decimal degrees. Distance and radius use meters. Pagination is one-based, page size is at most 100, and the computed offset must be a safe integer. Numeric strings are accepted for radius and pagination at runtime; the schema shows canonical numeric types. Searches use the existing distance/recency ranking and freshness window. See [API reference](API.md) for complete semantics.

## Authentication and server routing

The browser's Basic Auth challenge protects `/api-docs/`, its static assets and `/api-docs/openapi.json`. It is documentation authentication. The location endpoints do not implement a bearer token or reuse this middleware, so no fictitious Authorize/JWT scheme is declared. Apply any required API identity checks in your deployment's access layer.

Authorization persistence and URL-driven Swagger configuration are disabled. The external online validator is disabled; local contract validation is part of the tests.

`BASE_URL` changes the OpenAPI server target only. It does not add an Express route prefix or configure CORS. For a proxy prefix such as `/nearby`, set the matching external server path and configure proxy forwarding/rewriting separately. Prefer serving the console and API on the same origin. An absolute URL on another origin requires appropriate access/CORS handling at your deployment layer; the console cannot bypass browser policy or mixed-content restrictions.

## Export and import

The running, authenticated `/api-docs/openapi.json` contains runtime configuration. The checked-in [openapi.json](openapi.json) uses canonical defaults: server `/`, radius 10000 meters and maximum 100000 meters. Export builds the contract without loading `.env`, database settings or runtime credentials. The live specification continues to use validated application configuration.

```bash
npm run openapi:export
npm run openapi:check
```

Import the exported JSON into an OpenAPI-compatible API client. For an external client, select or replace the relative server URL with your authorized environment's absolute URL. No credentials are embedded in the export.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/api-docs/` returns 404 | Enable `SWAGGER_ENABLED` and restart; production defaults to disabled |
| Startup rejects Swagger settings | Set both dedicated credentials; check [Configuration](CONFIGURATION.md) constraints |
| Documentation returns 401 | Supply the configured Basic Auth credentials |
| Execute is absent | Remove an explicit false execution override or set it to true, then restart |
| Changed query input has no effect | Remove the same field from the JSON body or select the center-only example |
| Search does not show the test user | Check center, radius, TTL, page, exclusion and selected server |
| Readiness returns 503 | Check database connectivity and service logs |
| Readiness succeeds but location calls fail | Verify migration, PostGIS extension, database permissions and logs |
| Failed to fetch | Check target URL, proxy, network, TLS and browser cross-origin policy |

Database-independent tests validate the contract, examples, access rules and HTTP controllers. Optional DOM tests load the actual bundled UI scripts, select examples and execute all four operations against a local HTTP service with database/model stubs. They also verify snippets, timing, deep links, filtering and the explicit read-only override. See [Testing](TESTING.md) for commands and [Package validation](VALIDATION.md) for this package's executed checks and limitations.
