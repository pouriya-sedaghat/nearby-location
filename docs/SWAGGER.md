# Interactive Swagger

[Documentation index](README.md) · [API contract](API.md)

When `SWAGGER_ENABLED=true`, open `/api/docs/`. Outside development, sign in with the dedicated `SWAGGER_AUTH_USERNAME` and `SWAGGER_AUTH_PASSWORD`. This Basic login protects documentation only; use the separate location, metrics or privacy bearer scheme when the corresponding API surface requires it. Credentials are not persisted by Swagger UI.

The canonical mount is `/api/docs`; its trailing slash is used by the browser to resolve local resources. The previous `/api-docs` mount returns 404. Only GET/HEAD serve documentation; unsupported methods and unknown resources below this mount return English JSON 404. Authentication runs before body parsing, including for malformed or oversized JSON sent to a documentation URL. Swagger Execute still sends GET/POST requests to the actual API paths, with their independent bearer policy.

Enable `SWAGGER_TRY_IT_OUT_ENABLED` to execute requests. Root Compose retains enabled execution with generated documentation credentials; direct production and Kubernetes defaults are disabled. An upsert performs a real write to the selected server.

Start with liveness/readiness, select the synthetic create-location example, then search the same center. The language header input accepts `en` or `fa`; documentation stays English while human API text follows the selected language. Inspect live response headers, generated cURL, request duration and schema examples. Body options override matching query options; use the center-only example when editing query controls.

The runtime contract is `/api/docs/openapi.json` and reflects mounted privacy routes, authentication and radius settings. The canonical [OpenAPI file](openapi.json) describes all features. Its single explicit source is [openapi.definition.ts](../src/config/openapi.definition.ts), with runtime projection in [openapi.ts](../src/config/openapi.ts). Use `npm run openapi:export` and `npm run openapi:check` when maintaining it. Optional DOM execution checks are described in [Testing](TESTING.md).
